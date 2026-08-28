// Loads TanStack Start's module augmentation of router-core, which is what
// adds the `server: { handlers }` option to createFileRoute. Without this
// import somewhere in the program, every server route fails to typecheck.
import '@tanstack/react-start'
import { createRouter as createTanStackRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
