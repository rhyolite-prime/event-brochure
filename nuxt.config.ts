// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  app: {
    head: {
      title: 'In Loving Memory — Service Brochure',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Celebration of Life service brochure' },
        { name: 'theme-color', content: '#171412' }
      ],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400..700;1,400..600&family=Inter:wght@400;500;600&display=swap'
        }
      ]
    }
  },

  devServer: { host: '0.0.0.0', port: 3000 },

  vite: {
    server: {
      // allow the sandboxed preview host
      allowedHosts: true
    }
  }
})
