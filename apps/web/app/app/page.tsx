import { redirect } from 'next/navigation';

// The live GPS dashboard now lives in the unified Carva Fleet UI at /fleet
// (live Traccar data + embedded map). This route redirects there so existing
// links/bookmarks keep working. The previous MapLibre dashboard is in git history.
export default function AppRedirect() {
  redirect('/fleet');
}
