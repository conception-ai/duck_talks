<script lang="ts">
  import Router from 'svelte-spa-router';
  import HomePage from './routes/home/+page.svelte';
  import LivePage from './routes/live/+page.svelte';
</script>

<Router
  routes={{
    '/': HomePage,
    '/live': LivePage,
    '/live/:id': LivePage,
  }}
/>
