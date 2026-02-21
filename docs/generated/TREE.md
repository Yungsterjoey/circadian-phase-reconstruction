# KURO Directory Tree

> Auto-generated. Run: `node scripts/gen_context_pack.cjs`

├── docs/
│   ├── generated/
│   ├── ARCHITECTURE.md
│   ├── INTERFACES.md
│   ├── PHASES.md
│   └── SECURITY.md
├── kuro-sandbox/
│   ├── docker-compose.yml
│   ├── Dockerfile.runner
│   ├── index.js
│   └── kuro-sandbox.service
├── layers/
│   ├── auth/
│   │   ├── auth_middleware.cjs
│   │   ├── auth_routes.cjs
│   │   ├── db.cjs
│   │   ├── email_otp.cjs
│   │   └── tier_gate.cjs
│   ├── liveedit/
│   │   ├── liveedit_routes.cjs
│   │   └── stream_controller.cjs
│   ├── preempt/
│   │   ├── preempt_engine.cjs
│   │   ├── preempt_routes.cjs
│   │   ├── preempt_stream_patch.cjs
│   │   └── preempt_stream.cjs
│   ├── shadow/
│   │   ├── babylonProtocol.js
│   │   ├── config.js
│   │   ├── mnemosyneCache.js
│   │   ├── nephilimGate.js
│   │   └── ShadowVPN.js
│   ├── stripe/
│   │   └── stripe_routes.cjs
│   ├── tools/
│   │   └── context_router.cjs
│   ├── vfs/
│   ├── vision/
│   │   ├── vision_evaluator.cjs
│   │   ├── vision_gpu_mutex.cjs
│   │   ├── vision_intent.cjs
│   │   ├── vision_orchestrator.cjs
│   │   ├── vision_routes.cjs
│   │   ├── vision_scene_graph.cjs
│   │   └── vision_storage.cjs
│   ├── agent_orchestrator.js
│   ├── artifact_renderer.js
│   ├── audit_chain.js
│   ├── auth_middleware.js
│   ├── bloodhound.js
│   ├── capability_router.cjs
│   ├── cognitive_snapshots.js
│   ├── context_reactor.js
│   ├── edubba_archive.js
│   ├── fire_control.js
│   ├── flight_computer.js
│   ├── frontier_assist.js
│   ├── guest_gate.js
│   ├── harvester.js
│   ├── iff_gate.js
│   ├── iron_dome.js
│   ├── kuro_drive.js
│   ├── kuro_lab.js
│   ├── maat_refiner.js
│   ├── mcp_connectors.js
│   ├── memory.js
│   ├── model_warmer.js
│   ├── output_enhancer.js
│   ├── reactor_telemetry.js
│   ├── request_validator.js
│   ├── sandbox_routes.cjs
│   ├── self_heal.js
│   ├── semantic_router.js
│   ├── smash_protocol.js
│   ├── sovereignty_dashboard.js
│   ├── synthesis_layer.js
│   ├── table_rocket.js
│   ├── thinking_stream.js
│   ├── voter_layer.js
│   └── web_search.js
├── public/
│   └── kuro-logo.jpg
├── scripts/
│   ├── gen_context_pack.cjs
│   └── migrate_uploads.cjs
├── src/
│   ├── components/
│   │   ├── apps/
│   │   │   ├── AboutApp.jsx
│   │   │   ├── AdminApp.jsx
│   │   │   ├── KuroChatApp.jsx
│   │   │   ├── LiveEdit.jsx
│   │   │   ├── SandboxPanel.jsx
│   │   │   └── usePreempt.js
│   │   ├── AuthGate.jsx
│   │   ├── AuthModals.jsx
│   │   ├── ChatSidebar.jsx
│   │   ├── ConfirmModal.jsx
│   │   ├── CookieBanner.jsx
│   │   ├── DesktopBackground.jsx
│   │   ├── GlassDock.jsx
│   │   ├── GlassPanel.jsx
│   │   ├── KuroIcon.jsx
│   │   ├── LiquidGlassEngine.jsx
│   │   ├── UserMenu.jsx
│   │   └── WindowManager.jsx
│   ├── hooks/
│   │   └── usePreempt.js
│   ├── stores/
│   │   ├── authStore.js
│   │   └── osStore.js
│   ├── App.jsx
│   ├── liquid-glass.css
│   └── main.jsx
├── CLAUDE.md
├── deploy_liquid_glass.sh
├── deploy_preempt_v2.sh
├── deploy_preempt.sh
├── IMG_2342.jpg
├── index.html
├── KURO_COMPLETE.zip
├── KURO_FIX_BUNDLE.zip
├── KURO_OS_MASTER_PLAN_v4.md
├── kuro-chat-v72-updated.zip
├── kuro-liveedit-v11.zip
├── kuro-v9-sandbox-patch.zip
├── kuro-vision-v11.zip
├── KUROCHAT_PATCH_V2.js
├── KUROCHAT_PREEMPT_PATCH.js
├── landing.html
├── liquid-glass.css
├── LiquidGlassEngine.jsx
├── MIGRATION_GUIDE.js
├── package-lock.json
├── package.json
├── preempt_engine.cjs
├── preempt_routes.cjs
├── preempt_stream_patch.cjs
├── preempt_stream.cjs
├── SANDBOX_DELIVERABLE.md
├── server.cjs
├── usePreempt.js
└── vite.config.js