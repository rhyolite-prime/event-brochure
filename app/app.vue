<script setup>
// The brochure PDF lives in /public — swap public/brochure.pdf
// for the real file and everything updates automatically.
const brochure = {
  src: '/brochure.pdf',
  title: 'In Loving Memory',
  subtitle: 'Eleanor Mae Whitfield · 1941 — 2025'
}
</script>

<template>
  <PdfReader
    :src="brochure.src"
    :title="brochure.title"
    :subtitle="brochure.subtitle"
  />
</template>

<style>
html, body, #__nuxt {
  height: 100%;
  margin: 0;
  padding: 0;
}
* { box-sizing: border-box; }
</style>
