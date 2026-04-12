# WikiOS

WikiOS is a local-first wiki for Obsidian vaults. Point it at a folder, run the app, and browse your notes through a clean web interface with search, article pages, a homepage, stats, and a graph view.

## Quickstart

Clone and launch in one line:

```bash
git clone <repo-url> wiki-os && cd wiki-os && npm run first-run
```

Or, if you already have the repo locally:

```bash
npm install
npm start
```

WikiOS builds the app, starts one local server, and opens [http://localhost:5211](http://localhost:5211) in your default browser automatically. On first run, it will ask for your vault path in the browser and can also start with the bundled demo vault.

If you prefer to skip the setup screen, you can still point `WIKI_ROOT` at any Obsidian-compatible markdown folder before starting the app:

```bash
export WIKI_ROOT="/absolute/path/to/your/vault"
npm start
```

`npm start` is the recommended public user flow. It rebuilds the client and server together, then launches one server that serves both the UI and the API so frontend/backend versions stay in sync.

If you prefer to keep browser launch manual, run:

```bash
WIKIOS_OPEN_BROWSER=0 npm start
```

## Contributor Mode

```bash
npm run dev
```

Use `dev` only when you are actively working on WikiOS itself. It runs a split frontend/backend setup for faster iteration, which is useful for contributors but not the safest path for normal users.

## Prebuilt Server

```bash
npm run build
npm run serve
```

If no vault has been saved yet, open the app and complete the setup screen. Once a vault has been saved, that choice survives restarts and deploys by default. Advanced users can still force a temporary per-process override with `WIKIOS_FORCE_WIKI_ROOT`.

## Configuration

The public configuration surface is intentionally small:

- `WIKI_ROOT` bootstraps the app when no vault has been saved yet
- `WIKIOS_FORCE_WIKI_ROOT` forces a temporary per-process vault override
- `PORT` controls the server port
- `WIKIOS_INDEX_DB` overrides the SQLite index path
- `WIKIOS_ADMIN_TOKEN` protects the manual reindex endpoint
- `WIKIOS_DISABLE_WATCH=1` disables filesystem watching when needed
- `WIKIOS_OPEN_BROWSER=0` disables automatic browser launch in user mode

By default, WikiOS saves the chosen vault path in `~/.wiki-os/config.json` and stores hashed index databases under `~/.wiki-os/indexes/`.

For local demos, the bundled `sample-vault/` directory is ready to use from the setup screen.

### People model

WikiOS treats `People` as an explicit, user-controlled concept first. That means it tries to avoid guessing from vague mentions and instead relies on metadata you can control in your vault.

By default, WikiOS recognizes people from these signals:

- Frontmatter keys such as `person`, `people`, `type`, `kind`, and `entity`
- Tags such as `person`, `people`, `biography`, and `biographies`
- Folder names such as `people/`, `person/`, `biographies/`, and `biography/`

The default behavior is conservative: if a vault does not have explicit people matches, WikiOS can hide the `People` section instead of filling it with false positives.

You can customize the people rules in `wiki-os.config.ts`:

```ts
const config = {
  people: {
    enabled: true,
    frontmatterKeys: ["person", "people", "type", "kind", "entity"],
    folderNames: ["people", "person", "biographies", "biography"],
    tagNames: ["person", "people", "biography", "biographies"],
    mode: "hybrid",
  },
};
```

Use `mode: "explicit"` for the safest behavior, `mode: "hybrid"` when you want WikiOS to fall back to broader inference after the explicit metadata rules, and `mode: "off"` when you want to hide People entirely. Hybrid mode is useful for older vaults that do not yet have clean person metadata, but explicit metadata still wins when both exist.

WikiOS also supports per-vault local overrides from the article page. `Mark as person`, `Mark as not person`, and `Clear local override` are saved in `~/.wiki-os/config.json`, scoped to the current vault, and do not rewrite your Obsidian notes.

## Scripts

- `npm run first-run` installs dependencies, builds the app, starts it, and opens the browser
- `npm start` builds the app and launches the safe one-server user mode
- `npm run serve` launches the already-built server without rebuilding
- `npm run dev` starts the split frontend/backend contributor mode
- `npm run build` builds the client and server bundles
- `npm run deploy` runs the generic deploy helper in `scripts/deploy.sh`
- `npm run smoke-test` runs the endpoint smoke test in `scripts/smoke-test.sh`

## What it ships

- Homepage with featured content, recent items, and topic browsing
- Fast local search
- Dedicated article pages
- Graph and stats views
- Manual reindex endpoint
- File watching for incremental updates

## License

MIT
