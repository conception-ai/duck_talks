<script lang="ts">
  import Router from 'svelte-spa-router';
  import LivePage from './routes/live/+page.svelte';
  import RecordingsPage from './routes/recordings/+page.svelte';
  import NewUIPage from './routes/new-ui/+page.svelte';
</script>

<Router
  routes={{
    '/': LivePage,
    '/:id': LivePage,
    '/recordings': RecordingsPage,
    '/new-ui': NewUIPage,
  }}
/>
