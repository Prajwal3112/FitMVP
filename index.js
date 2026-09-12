// Polyfill `crypto.getRandomValues` for React Native (Hermes lacks it).
// MUST be imported before anything that uses ulid / uuid / Zod-with-uuid.
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
