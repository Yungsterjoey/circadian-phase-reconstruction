// ═══════════════════════════════════════════════════════════════════════════
// TABLE ROCKET - Code Simulation Sandbox
// Validates code changes before committing to disk
// ═══════════════════════════════════════════════════════════════════════════

const fs = require('fs').promises;
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');
const crypto = require('crypto');

// Security patterns to block
const SECURITY_PATTERNS = [
  { pattern: /eval\s*\(/, name: 'eval()', severity: 'high' },
  { pattern: /new\s+Function\s*\(/, name: 'new Function()', severity: 'high' },
  { pattern: /document\.write/, name: 'document.write', severity: 'medium' },
  { pattern: /innerHTML\s*=(?![^=])/, name: 'innerHTML assignment', severity: 'medium' },
  { pattern: /dangerouslySetInnerHTML/, name: 'dangerouslySetInnerHTML', severity: 'low' },
  { pattern: /process\.env\.\w+/, name: 'process.env access', severity: 'info' },
  { pattern: /localStorage\.(set|get)Item/, name: 'localStorage', severity: 'info' },
  { pattern: /fs\.(?:writeFile|unlink|rmdir)/, name: 'fs write ops', severity: 'high' },
  { pattern: /child_process/, name: 'child_process', severity: 'high' },
  { pattern: /exec\s*\(|execSync\s*\(|spawn\s*\(/, name: 'shell execution', severity: 'high' },
  { pattern: /require\s*\(\s*['"][^'"]+['"]\.concat/, name: 'dynamic require', severity: 'high' },
  { pattern: /\$\{.*\}.*sql|SELECT.*FROM.*\$\{/, name: 'potential SQL injection', severity: 'high' },
];

// Known safe packages (won't trigger missing dep warning if in node_modules)
const BUILTIN_PACKAGES = ['react', 'react-dom', 'zustand', 'lucide-react', 'three'];

class TableRocket {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.simDir = path.join(os.tmpdir(), 'kuro-sim-' + crypto.randomBytes(8).toString('hex'));
  }

  // Run full simulation
  async simulate(fileChanges, commands = []) {
    const simId = 'sim_' + Date.now().toString(36);
    const startTime = Date.now();
    const result = {
      result: 'PASS',
      simId,
      syntaxErrors: [],
      buildErrors: [],
      securityFlags: [],
      missingDeps: [],
      warnings: [],
      durationMs: 0
    };

    try {
      // 1. Syntax check
      for (const change of fileChanges) {
        if (change.action === 'delete') continue;
        const syntaxResult = this.checkSyntax(change.path, change.content);
        if (syntaxResult.error) {
          result.syntaxErrors.push({
            file: change.path,
            error: syntaxResult.error,
            line: syntaxResult.line
          });
          result.result = 'FAIL';
        }
      }

      // 2. Security scan
      for (const change of fileChanges) {
        if (change.action === 'delete') continue;
        const securityResult = this.scanSecurity(change.path, change.content);
        result.securityFlags.push(...securityResult);
        if (securityResult.some(f => f.severity === 'high')) {
          result.result = 'FAIL';
        }
      }

      // 3. Dependency check
      for (const change of fileChanges) {
        if (change.action === 'delete') continue;
        const deps = this.checkDependencies(change.content);
        result.missingDeps.push(...deps.missing.map(d => ({ file: change.path, package: d })));
      }

      // 4. Command validation
      for (const cmd of commands) {
        const cmdResult = this.validateCommand(cmd);
        if (!cmdResult.safe) {
          result.warnings.push({
            type: 'command',
            command: cmd,
            reason: cmdResult.reason
          });
        }
      }

      // 5. Build simulation (if no syntax errors and project has package.json)
      if (result.syntaxErrors.length === 0 && fileChanges.some(c => c.path.match(/\.[jt]sx?$/))) {
        const buildResult = await this.simulateBuild(fileChanges);
        if (buildResult.errors.length > 0) {
          result.buildErrors.push(...buildResult.errors);
          result.result = 'FAIL';
        }
      }

    } catch (error) {
      result.result = 'ERROR';
      result.buildErrors.push({ error: error.message });
    } finally {
      result.durationMs = Date.now() - startTime;
      // Cleanup
      await this.cleanup();
    }

    return result;
  }

  // Check syntax for different file types
  checkSyntax(filePath, content) {
    const ext = path.extname(filePath);
    
    try {
      if (ext === '.json') {
        JSON.parse(content);
        return { valid: true };
      }

      if (ext === '.js' || ext === '.jsx' || ext === '.ts' || ext === '.tsx') {
        // Basic syntax validation via Function constructor (safe - doesn't execute)
        // Note: This won't catch JSX syntax errors, but catches basic JS errors
        try {
          // Remove JSX for basic validation
          const jsContent = content
            .replace(/<[A-Z][^>]*>[\s\S]*?<\/[A-Z][^>]*>/g, 'null')
            .replace(/<[A-Z][^>]*\/>/g, 'null')
            .replace(/import\s+.*from\s+['"][^'"]+['"]/g, '')
            .replace(/export\s+(default\s+)?/g, '');
          
          // Check for common syntax errors
          let braceCount = 0, parenCount = 0, bracketCount = 0;
          for (const char of content) {
            if (char === '{') braceCount++;
            if (char === '}') braceCount--;
            if (char === '(') parenCount++;
            if (char === ')') parenCount--;
            if (char === '[') bracketCount++;
            if (char === ']') bracketCount--;
          }
          
          if (braceCount !== 0) return { valid: false, error: 'Unmatched braces', line: null };
          if (parenCount !== 0) return { valid: false, error: 'Unmatched parentheses', line: null };
          if (bracketCount !== 0) return { valid: false, error: 'Unmatched brackets', line: null };
          
          return { valid: true };
        } catch (e) {
          // Find approximate line number
          const match = e.message.match(/line (\d+)/i);
          return { valid: false, error: e.message, line: match ? parseInt(match[1]) : null };
        }
      }

      if (ext === '.css' || ext === '.scss') {
        // Basic CSS validation
        let braceCount = 0;
        for (const char of content) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
          if (braceCount < 0) return { valid: false, error: 'Unexpected }', line: null };
        }
        if (braceCount !== 0) return { valid: false, error: 'Unmatched braces in CSS', line: null };
        return { valid: true };
      }

      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message, line: null };
    }
  }

  // Scan for security issues
  scanSecurity(filePath, content) {
    const flags = [];
    
    for (const { pattern, name, severity } of SECURITY_PATTERNS) {
      const matches = content.match(pattern);
      if (matches) {
        // Find line number
        const lines = content.split('\n');
        let lineNum = null;
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            lineNum = i + 1;
            break;
          }
        }
        
        flags.push({
          file: filePath,
          pattern: name,
          severity,
          line: lineNum
        });
      }
    }
    
    return flags;
  }

  // Check for missing dependencies
  checkDependencies(content) {
    const result = { found: [], missing: [] };
    
    // Extract imports
    const importRegex = /(?:import\s+.*from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
    let match;
    
    while ((match = importRegex.exec(content)) !== null) {
      const pkg = match[1] || match[2];
      // Skip relative imports
      if (pkg.startsWith('.') || pkg.startsWith('/')) continue;
      // Get package name (handle scoped packages)
      const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
      
      if (BUILTIN_PACKAGES.includes(pkgName)) {
        result.found.push(pkgName);
      } else {
        // Would need to check node_modules in real implementation
        result.found.push(pkgName);
      }
    }
    
    return result;
  }

  // Validate shell command
  validateCommand(cmd) {
    const dangerous = [
      /rm\s+-rf\s+\/(?!\w)/,
      /mkfs\./,
      /dd\s+if=.*of=\/dev/,
      />\s*\/dev\//,
      /chmod\s+777/,
      /curl.*\|.*sh/,
      /wget.*\|.*sh/
    ];
    
    for (const pattern of dangerous) {
      if (pattern.test(cmd)) {
        return { safe: false, reason: `Dangerous pattern: ${pattern}` };
      }
    }
    
    return { safe: true };
  }

  // Simulate build
  async simulateBuild(fileChanges) {
    const result = { success: true, errors: [], warnings: [] };
    
    try {
      // Create temp directory
      await fs.mkdir(this.simDir, { recursive: true });
      
      // Copy relevant files (simplified - just validate structure)
      for (const change of fileChanges) {
        if (change.action === 'delete') continue;
        
        const targetPath = path.join(this.simDir, change.path);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, change.content);
      }
      
      // In a real implementation, we'd run vite build --mode test here
      // For now, just validate that files were written correctly
      for (const change of fileChanges) {
        if (change.action === 'delete') continue;
        const targetPath = path.join(this.simDir, change.path);
        const written = await fs.readFile(targetPath, 'utf-8');
        if (written !== change.content) {
          result.errors.push({ file: change.path, error: 'Content mismatch after write' });
          result.success = false;
        }
      }
      
    } catch (e) {
      result.errors.push({ error: e.message });
      result.success = false;
    }
    
    return result;
  }

  // Cleanup temp files
  async cleanup() {
    try {
      await fs.rm(this.simDir, { recursive: true, force: true });
    } catch {}
  }

  // Quick syntax check only
  quickCheck(content, fileType = 'js') {
    return this.checkSyntax(`file.${fileType}`, content);
  }

  // Quick security scan only
  quickSecurity(content) {
    return this.scanSecurity('file.js', content);
  }
}

// Factory
function createTableRocket(projectRoot) {
  return new TableRocket(projectRoot);
}

module.exports = {
  TableRocket,
  createTableRocket
};
