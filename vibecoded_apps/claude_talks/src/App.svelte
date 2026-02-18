<script lang="ts">
  import Router from 'svelte-spa-router';
  import LivePage from './routes/live/+page.svelte';
</script>

<Router
  routes={{
    '/': LivePage,
    '/live': LivePage,
  }}
/>
