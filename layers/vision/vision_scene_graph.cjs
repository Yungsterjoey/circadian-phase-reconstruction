/**
 * KURO::VISION — Scene Graph Generator
 * 
 * Uses kuro-eye (Qwen2.5-VL 7B) to produce structured scene_graph.json:
 *   - Object bounding boxes with z-order
 *   - Camera/lighting descriptions
 *   - Reserved text boxes with coordinates
 *   - Diffusion prompt (cleaned, optimized)
 * 
 * Stored in session memory for reliable edits without prompt drift.
 * 
 * v6.3 compliance: Uses Ollama HTTP API only, no exec.
 */

const axios = require('axios');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const KURO_EYE = 'huihui_ai/qwen3-vl-abliterated:30b-a3b-instruct-q4_K_M';

// ─── Scene Graph Prompt ──────────────────────────────────────────────────

const SCENE_GRAPH_SYSTEM = `You are a scene composition planner for image generation.
Given a user's image request, output ONLY valid JSON (no markdown, no backticks, no explanation).

Output this exact schema:
{
  "diffusion_prompt": "optimized prompt for FLUX image generation, rich visual detail, no text instructions",
  "negative_prompt": "things to avoid",
  "dimensions": { "width": 1024, "height": 1024 },
  "objects": [
    {
      "id": "obj_1",
      "label": "description",
      "bbox": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4 },
      "z_order": 1
    }
  ],
  "text_boxes": [
    {
      "id": "txt_1",
      "text": "actual text to render",
      "bbox": { "x": 0.1, "y": 0.1, "w": 0.8, "h": 0.1 },
      "font_size": 48,
      "color": "#FFFFFF",
      "align": "center",
      "style": "bold"
    }
  ],
  "camera": { "angle": "eye-level", "distance": "medium" },
  "lighting": { "direction": "top-left", "type": "natural", "mood": "warm" },
  "style": "photorealistic"
}

bbox coordinates are normalized 0.0-1.0 relative to image dimensions.
text_boxes: include ALL text the user wants rendered. Estimate good positions.
If no text needed, return empty text_boxes array.
diffusion_prompt: NEVER include text content — text is rendered separately.`;

// ─── Generate Scene Graph ────────────────────────────────────────────────

async function generateSceneGraph(userPrompt, intent, existingGraph = null) {
  let contextPrompt = userPrompt;
  
  // For edits, include existing graph as context
  if (intent.pipeline === 'edit' && existingGraph) {
    contextPrompt = `EXISTING SCENE:\n${JSON.stringify(existingGraph, null, 2)}\n\nUSER EDIT REQUEST: ${userPrompt}\n\nUpdate the scene graph to reflect the edit. Keep unchanged elements the same.`;
  }

  try {
    const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: KURO_EYE,
      messages: [
        { role: 'system', content: SCENE_GRAPH_SYSTEM },
        { role: 'user', content: contextPrompt }
      ],
      stream: false,
      options: { temperature: 0.1, num_predict: 800, num_ctx: 4096 }
    }, { timeout: 30000 });

    const raw = (data.message?.content || '').trim();
    
    // Strip markdown fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    const graph = JSON.parse(cleaned);
    
    // Validate + defaults
    if (!graph.diffusion_prompt) throw new Error('Missing diffusion_prompt');
    graph.objects = graph.objects || [];
    graph.text_boxes = graph.text_boxes || [];
    graph.dimensions = graph.dimensions || { width: 1024, height: 1024 };
    graph.camera = graph.camera || { angle: 'eye-level', distance: 'medium' };
    graph.lighting = graph.lighting || { direction: 'top-left', type: 'natural', mood: 'neutral' };
    graph.style = graph.style || 'photorealistic';
    
    // Denormalize text box coordinates for compositor
    graph._text_boxes_px = graph.text_boxes.map(tb => ({
      ...tb,
      x: Math.round(tb.bbox.x * graph.dimensions.width),
      y: Math.round(tb.bbox.y * graph.dimensions.height),
      max_width: Math.round(tb.bbox.w * graph.dimensions.width),
      max_height: Math.round(tb.bbox.h * graph.dimensions.height),
      font_size: tb.font_size || 32,
      color: tb.color || '#FFFFFF',
      align: tb.align || 'left'
    }));
    
    return { success: true, graph };
  } catch (e) {
    console.error('[SCENE_GRAPH] Parse error:', e.message);
    
    // Fallback: construct minimal graph from prompt
    return {
      success: true,
      graph: buildFallbackGraph(userPrompt, intent),
      fallback: true
    };
  }
}

// ─── Fallback Graph ──────────────────────────────────────────────────────

function buildFallbackGraph(prompt, intent) {
  const graph = {
    diffusion_prompt: prompt.replace(/["'`].*?["'`]/g, '').trim(),
    negative_prompt: 'blurry, low quality, distorted, deformed',
    dimensions: { width: 1024, height: 1024 },
    objects: [],
    text_boxes: [],
    camera: { angle: 'eye-level', distance: 'medium' },
    lighting: { direction: 'top-left', type: 'natural', mood: 'neutral' },
    style: 'photorealistic',
    _text_boxes_px: []
  };

  // Add text boxes from detected segments
  if (intent.textSegments?.length > 0) {
    const yStep = 0.8 / intent.textSegments.length;
    intent.textSegments.forEach((text, i) => {
      const tb = {
        id: `txt_${i + 1}`,
        text,
        bbox: { x: 0.1, y: 0.1 + (i * yStep), w: 0.8, h: Math.min(0.15, yStep - 0.02) },
        font_size: intent.textSegments.length > 2 ? 28 : 42,
        color: '#FFFFFF',
        align: 'center',
        style: 'bold'
      };
      graph.text_boxes.push(tb);
      graph._text_boxes_px.push({
        ...tb,
        x: Math.round(tb.bbox.x * 1024),
        y: Math.round(tb.bbox.y * 1024),
        max_width: Math.round(tb.bbox.w * 1024),
        max_height: Math.round(tb.bbox.h * 1024)
      });
    });
  }

  return graph;
}

module.exports = { generateSceneGraph, buildFallbackGraph };
