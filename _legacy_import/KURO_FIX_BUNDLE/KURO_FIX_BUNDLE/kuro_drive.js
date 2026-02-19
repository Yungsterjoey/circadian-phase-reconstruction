// ═══════════════════════════════════════════════════════════════════════════
// KURO::DRIVE - Neural ERP / Digital Thread
// Project graph management for intelligent context injection
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const GRAPH_FILE = '.kuro/project_graph.json';
const MAX_HISTORY = 100;

// Simple AST-free import/export detection (works without acorn)
function parseImportsExports(content, filePath) {
  const imports = [];
  const exports = [];
  
  // ES6 imports
  const importRegex = /import\s+(?:(\{[^}]+\})|(\*\s+as\s+\w+)|(\w+))?\s*(?:,\s*(?:(\{[^}]+\})|(\w+)))?\s*from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const names = [];
    if (match[1]) names.push(...match[1].replace(/[{}]/g, '').split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean));
    if (match[2]) names.push(match[2].replace('* as ', '').trim());
    if (match[3]) names.push('default');
    if (match[4]) names.push(...match[4].replace(/[{}]/g, '').split(',').map(s => s.trim().split(' as ')[0].trim()).filter(Boolean));
    if (match[5]) names.push('default');
    imports.push({ from: match[6], names });
  }
  
  // CommonJS require
  const requireRegex = /(?:const|let|var)\s+(?:(\{[^}]+\})|(\w+))\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = requireRegex.exec(content)) !== null) {
    const names = [];
    if (match[1]) names.push(...match[1].replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean));
    if (match[2]) names.push(match[2]);
    imports.push({ from: match[3], names });
  }
  
  // ES6 exports
  const exportDefaultRegex = /export\s+default\s+(?:function\s+)?(\w+)?/g;
  while ((match = exportDefaultRegex.exec(content)) !== null) {
    exports.push(match[1] ? `default:${match[1]}` : 'default');
  }
  
  const exportNamedRegex = /export\s+(?:const|let|var|function|class)\s+(\w+)/g;
  while ((match = exportNamedRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }
  
  const exportBracesRegex = /export\s*\{([^}]+)\}/g;
  while ((match = exportBracesRegex.exec(content)) !== null) {
    exports.push(...match[1].split(',').map(s => s.trim().split(' as ').pop().trim()).filter(Boolean));
  }
  
  // CommonJS exports
  if (/module\.exports\s*=/.test(content)) {
    exports.push('default');
  }
  
  return { imports, exports };
}

// Detect file type
function detectFileType(filePath, content) {
  const ext = path.extname(filePath);
  const basename = path.basename(filePath);
  
  if (basename.includes('Store') || basename.includes('store')) return 'store';
  if (basename.includes('App') || basename.includes('Page') || basename.includes('View')) return 'component';
  if (ext === '.css' || ext === '.scss') return 'style';
  if (ext === '.json') return 'config';
  if (basename.startsWith('use') || /^export\s+(const|function)\s+use[A-Z]/.test(content)) return 'hook';
  if (/createContext|useContext/.test(content)) return 'context';
  if (ext === '.jsx' || ext === '.tsx') return 'component';
  if (ext === '.js' || ext === '.ts') return 'module';
  return 'other';
}

// Hash content
function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

class KuroDrive {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.graphPath = path.join(projectRoot, GRAPH_FILE);
    this.graph = null;
  }

  // Initialize/load graph
  async init() {
    try {
      const data = await fs.readFile(this.graphPath, 'utf-8');
      this.graph = JSON.parse(data);
    } catch {
      this.graph = {
        projectId: path.basename(this.projectRoot),
        lastUpdated: new Date().toISOString(),
        nodes: {},
        edges: [],
        changeHistory: []
      };
      await this.save();
    }
    return this;
  }

  // Save graph
  async save() {
    this.graph.lastUpdated = new Date().toISOString();
    await fs.mkdir(path.dirname(this.graphPath), { recursive: true });
    await fs.writeFile(this.graphPath, JSON.stringify(this.graph, null, 2));
  }

  // Resolve import path to actual file
  resolveImportPath(fromFile, importPath) {
    if (importPath.startsWith('.')) {
      const dir = path.dirname(fromFile);
      let resolved = path.join(dir, importPath);
      // Try common extensions
      for (const ext of ['', '.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx']) {
        const full = resolved + ext;
        if (this.graph.nodes[full]) return full;
      }
      return resolved;
    }
    return importPath; // External package
  }

  // Update or create node for file
  async updateNode(filePath, content = null, aiModel = null, prompt = null) {
    const relativePath = filePath.startsWith(this.projectRoot) 
      ? path.relative(this.projectRoot, filePath) 
      : filePath;
    
    if (content === null) {
      try {
        content = await fs.readFile(path.join(this.projectRoot, relativePath), 'utf-8');
      } catch {
        return null;
      }
    }
    
    const { imports, exports } = parseImportsExports(content, relativePath);
    const type = detectFileType(relativePath, content);
    const hash = hashContent(content);
    
    const existingNode = this.graph.nodes[relativePath];
    const isAIUpdate = aiModel !== null;
    
    this.graph.nodes[relativePath] = {
      type,
      exports,
      imports,
      lastModified: new Date().toISOString(),
      lastAIHash: isAIUpdate ? hash : (existingNode?.lastAIHash || null),
      aiTouchCount: isAIUpdate ? (existingNode?.aiTouchCount || 0) + 1 : (existingNode?.aiTouchCount || 0),
      contentHash: hash
    };
    
    // Update edges
    this.graph.edges = this.graph.edges.filter(e => e.from !== relativePath);
    for (const imp of imports) {
      const target = this.resolveImportPath(relativePath, imp.from);
      if (!target.includes('node_modules')) {
        this.graph.edges.push({
          from: relativePath,
          to: target,
          type: 'import',
          names: imp.names
        });
      }
    }
    
    // Add to history if AI update
    if (isAIUpdate) {
      this.graph.changeHistory.unshift({
        timestamp: new Date().toISOString(),
        file: relativePath,
        action: existingNode ? 'modify' : 'create',
        aiModel,
        hash,
        prompt: prompt?.slice(0, 100)
      });
      // Trim history
      if (this.graph.changeHistory.length > MAX_HISTORY) {
        this.graph.changeHistory = this.graph.changeHistory.slice(0, MAX_HISTORY);
      }
    }
    
    await this.save();
    return this.graph.nodes[relativePath];
  }

  // Get all files related to target file
  getRelatedFiles(targetFile, maxDepth = 2) {
    const related = new Set();
    const visited = new Set();
    
    const traverse = (file, depth) => {
      if (depth > maxDepth || visited.has(file)) return;
      visited.add(file);
      
      // Get dependencies (files this file imports)
      for (const edge of this.graph.edges) {
        if (edge.from === file && this.graph.nodes[edge.to]) {
          related.add(edge.to);
          traverse(edge.to, depth + 1);
        }
      }
      
      // Get dependents (files that import this file)
      for (const edge of this.graph.edges) {
        if (edge.to === file && this.graph.nodes[edge.from]) {
          related.add(edge.from);
          traverse(edge.from, depth + 1);
        }
      }
    };
    
    traverse(targetFile, 0);
    related.delete(targetFile);
    return Array.from(related);
  }

  // Get impact radius (what breaks if file changes)
  getImpactRadius(targetFile) {
    const impacted = new Set();
    const queue = [targetFile];
    
    while (queue.length > 0) {
      const current = queue.shift();
      for (const edge of this.graph.edges) {
        if (edge.to === current && !impacted.has(edge.from)) {
          impacted.add(edge.from);
          queue.push(edge.from);
        }
      }
    }
    
    return Array.from(impacted);
  }

  // Suggest context files based on prompt
  suggestContext(userPrompt, maxFiles = 5) {
    const prompt = userPrompt.toLowerCase();
    const scores = {};
    
    for (const [filePath, node] of Object.entries(this.graph.nodes)) {
      let score = 0;
      const fileName = path.basename(filePath).toLowerCase();
      const dirName = path.dirname(filePath).toLowerCase();
      
      // Exact file mention
      if (prompt.includes(fileName.replace(/\.[jt]sx?$/, ''))) score += 10;
      
      // Type keywords
      if (node.type === 'component' && (prompt.includes('component') || prompt.includes('ui') || prompt.includes('view'))) score += 5;
      if (node.type === 'store' && (prompt.includes('state') || prompt.includes('store') || prompt.includes('zustand'))) score += 5;
      if (node.type === 'hook' && prompt.includes('hook')) score += 5;
      
      // Common keywords
      if (prompt.includes('style') && (fileName.includes('style') || filePath.includes('.css'))) score += 5;
      if (prompt.includes('api') && (fileName.includes('api') || dirName.includes('api'))) score += 5;
      if (prompt.includes('app') && fileName.includes('app')) score += 3;
      if (prompt.includes('executioner') && fileName.includes('executioner')) score += 10;
      if (prompt.includes('glass') && fileName.includes('glass')) score += 8;
      if (prompt.includes('window') && fileName.includes('window')) score += 8;
      if (prompt.includes('dock') && fileName.includes('dock')) score += 8;
      if (prompt.includes('panel') && fileName.includes('panel')) score += 8;
      
      // Boost recently AI-modified files
      if (node.aiTouchCount > 0) score += Math.min(node.aiTouchCount, 3);
      
      if (score > 0) scores[filePath] = score;
    }
    
    // Sort by score and return top files
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxFiles)
      .map(([filePath]) => filePath);
  }

  // Get file content with context
  async getFileWithContext(filePath, includeRelated = true) {
    const content = await fs.readFile(path.join(this.projectRoot, filePath), 'utf-8');
    const node = this.graph.nodes[filePath];
    
    const result = {
      path: filePath,
      content,
      type: node?.type || 'unknown',
      exports: node?.exports || [],
      imports: node?.imports || []
    };
    
    if (includeRelated) {
      const related = this.getRelatedFiles(filePath, 1);
      result.relatedFiles = related.slice(0, 5);
    }
    
    return result;
  }

  // Scan entire project and build graph
  async scanProject(srcDir = 'src') {
    const srcPath = path.join(this.projectRoot, srcDir);
    const files = await this.walkDir(srcPath);
    
    for (const file of files) {
      const relativePath = path.relative(this.projectRoot, file);
      if (/\.[jt]sx?$/.test(file)) {
        await this.updateNode(relativePath);
      }
    }
    
    return this;
  }

  // Walk directory recursively
  async walkDir(dir) {
    const files = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await this.walkDir(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch {}
    return files;
  }

  // Get graph stats
  getStats() {
    return {
      totalFiles: Object.keys(this.graph.nodes).length,
      totalEdges: this.graph.edges.length,
      aiModifiedFiles: Object.values(this.graph.nodes).filter(n => n.aiTouchCount > 0).length,
      recentChanges: this.graph.changeHistory.slice(0, 10)
    };
  }
}

// Factory
async function createKuroDrive(projectRoot) {
  const drive = new KuroDrive(projectRoot);
  await drive.init();
  return drive;
}

module.exports = {
  KuroDrive,
  createKuroDrive
};
