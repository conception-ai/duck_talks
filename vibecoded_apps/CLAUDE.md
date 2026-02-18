# Vibecoded Apps

Rapid prototyping folder. The goal is to validate **UI/UX**, not produce production code.

## Hard Rules

**NEVER go outside `vibecoded_apps/` scope.**

**Routes NEVER import from each other.** Each route is an isolated sandbox.

## Setup

Each POC is a new folder in `vibecoded_apps/`. Copy the template to start:
```bash
cp -r svelte-app-template/ my-poc/
cd my-poc && npm install
```

## Route Structure

Each person has their own isolated route:

```
my-poc/src/
├── App.svelte                     # Router (svelte-spa-router)
└── routes/
    ├── home/                      # Landing page
    ├── daniel/                    # PM sandbox
    │   ├── +page.svelte           # Main page
    │   ├── types.ts               # Local types (optional)
    │   ├── utils.ts               # Local utils (optional)
    │   └── components/            # Local components
    │
    └── elie/                      # Designer sandbox
        └── (same structure)
```

## Best Practices

**Run `npm run check` often** to catch TypeScript errors early.

**Svelte 5 Runes** - Use modern syntax:
```svelte
<script lang="ts">
  let { data } = $props();           // Props
  let count = $state(0);             // Reactive state
  let doubled = $derived(count * 2); // Computed values
</script>
```

**Icons** - Always use FontAwesome, never emojis or unicode:
```svelte
<script>
  import { FontAwesomeIcon } from '@fortawesome/svelte-fontawesome';
  import { faCheck } from '@fortawesome/free-solid-svg-icons';
</script>
<FontAwesomeIcon icon={faCheck} />
```

**Styles** - Use CSS variables only, no hardcoded colors:
```css
/* Good */
color: var(--color-blue-500);
/* Bad */
color: #2e90fa;
```

**TypeScript** - Avoid `any`, use proper types.

## Store Architecture

**Two stores** in `stores/`:
- `data.svelte.ts` — core app truth (messages, session status, domain state). Owns lifecycle.
- `ui.svelte.ts` — screen state owned by UI components (panels, preferences). Can persist across sessions.

**Port interfaces in `types.ts`** — define contracts as plain TS interfaces. Implementations satisfy them structurally. Keeps `.ts` files decoupled from `.svelte.ts` runes.

**Zero `$effect`** — mutations via explicit methods on stores, not reactive side effects.

**Dependency injection at the edge** — `+page.svelte` wires concrete implementations (audio, API) into stores. Stores take ports as constructor args. Swap real for mock without touching business logic.

**Swappable backends** — `ConverseApi`, `AudioSink`, `LiveBackend` are interfaces. Test with mocks, develop with `/api/converse/test`.

## Summary

**Forbidden:**
- Importing from another route
- Going outside `vibecoded_apps/`

**Required:**
- Stay in your own route
