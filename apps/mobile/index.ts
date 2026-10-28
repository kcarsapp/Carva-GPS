import { registerRootComponent } from 'expo';
import App from './App';

// A local entry point keeps Expo's Metro resolver inside this workspace when
// dependencies are hoisted at the monorepo root.
registerRootComponent(App);
