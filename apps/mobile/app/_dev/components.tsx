import { Redirect } from 'expo-router';
export default function Components() {
  if (!__DEV__) return <Redirect href="/" />;
  const Gallery = require('../../src/testing/ComponentGallery').default;
  return <Gallery />;
}
