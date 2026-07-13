import { Platform } from 'react-native';

// Netlify Functions are same-origin on web, so a relative path works there.
// Native builds have no window.location origin, so they need the deployed
// site's absolute URL instead.
export const FUNCTIONS_BASE =
  Platform.OS === 'web' ? '' : 'https://lovewords1234.netlify.app';
