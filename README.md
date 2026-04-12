# WikiOS

WikiOS turns an Obsidian vault into a local web app. It lets you browse notes through a homepage, search, article pages, a graph view, and stats.

Built by [Ansub](http://twitter.com/ansubkhan), co-founder of [Supafast](https://withsupafast.com/?utm_source=github&utm_medium=readme&utm_campaign=wikios) - we build websites for B2B SaaS & AI companies.

## What it does

- Connects to an Obsidian-compatible markdown folder
- Builds a local searchable index
- Gives you a clean web interface for exploring your notes
- Watches the vault for changes and updates the index automatically

## How to get started

Clone and launch:

```bash
git clone https://github.com/Ansub/wiki-os.git wiki-os && cd wiki-os && npm run first-run
```

WikiOS will open in your browser and guide you through choosing a vault. You can also use the bundled demo vault on first run.

## Features

- Homepage with featured notes, recent notes, and people highlights
- Fast local search
- Clean article pages
- Graph view
- Stats view
- Manual reindex support
- Automatic file watching
- Local-first setup with no cloud requirement

## Contributor mode

For normal users, use:

```bash
npm start
```

For contributors working on WikiOS itself, use:

```bash
npm run dev
```

`dev` runs a split frontend/backend setup for faster iteration.

## Folder structure

- `src/client/` contains the React app, routes, and UI components
- `src/server/` contains the Fastify server, setup flow, runtime config, and platform helpers
- `src/lib/` contains the wiki core
- `sample-vault/` contains the bundled demo content
- `scripts/` contains launch, deploy, and smoke-test helpers

## Advanced

### Useful commands

- `npm run build` builds the client and server
- `npm run serve` runs the already-built server
- `npm run smoke-test` runs the smoke test helper

### Environment variables

- `WIKI_ROOT` bootstraps the app with a vault path
- `WIKIOS_FORCE_WIKI_ROOT` forces a temporary per-process vault override
- `PORT` sets the server port
- `WIKIOS_INDEX_DB` overrides the SQLite index path
- `WIKIOS_ADMIN_TOKEN` protects the manual reindex endpoint
- `WIKIOS_DISABLE_WATCH=1` disables filesystem watching

By default, WikiOS saves the selected vault in `~/.wiki-os/config.json` and stores hashed SQLite indexes under `~/.wiki-os/indexes/`.

### People model

WikiOS treats `People` as an explicit, user-controlled concept first. By default it recognizes people from:

- frontmatter keys like `person`, `people`, `type`, `kind`, and `entity`
- tags like `person`, `people`, `biography`, and `biographies`
- folders like `people/`, `person/`, `biographies/`, and `biography/`

You can customize this in `wiki-os.config.ts` with `people.mode`:

- `explicit` is the safest default
- `hybrid` allows broader inference after explicit metadata
- `off` hides People entirely

Local person overrides are saved in `~/.wiki-os/config.json` and do not rewrite your notes.

## License

MIT
