# Third-party notices

## HEIC decoder

The application uses **heic-to 1.6.5**, copyright its contributors, under **GNU LGPL version 3 or later**, unmodified and installed from the public npm registry. This package includes libheif and its decoding dependencies. The package's license is distributed at `public/licenses/heic-to-LGPL-3.0.txt` together with the GNU GPL v3 text incorporated by LGPL v3.

- Project and source: https://github.com/hoppergee/heic-to
- Exact package and source files: https://registry.npmjs.org/heic-to/-/heic-to-1.6.5.tgz
- libheif upstream: https://github.com/strukturag/libheif
- libde265 upstream: https://github.com/strukturag/libde265
- The dependency's build instructions and versions are in its README and source distribution.

The HEIC adapter is dynamically imported from `src/engine/io.ts` and built into a separate decoder chunk. To replace or modify it, change the `heic-to` dependency to your compatible source package/path and run `pnpm install && pnpm build`. All application sources and build files needed to rebuild this combination are provided in this repository. There is no technical restriction against modifying or replacing this library.

## Other libraries

- React and React DOM: MIT, https://github.com/facebook/react
- Lucide icons: ISC, https://github.com/lucide-icons/lucide
- Vite: MIT, https://github.com/vitejs/vite
- TypeScript: Apache-2.0, https://github.com/microsoft/TypeScript
- Vitest: MIT, https://github.com/vitest-dev/vitest
- Playwright: Apache-2.0, https://github.com/microsoft/playwright

Exact installed versions are recorded in `pnpm-lock.yaml`. Each package retains its notices and license in its npm distribution.
