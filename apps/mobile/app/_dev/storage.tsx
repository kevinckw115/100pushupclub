import { Redirect } from 'expo-router';
export default function StorageReview() {
  if (!__DEV__) return <Redirect href="/" />;
  const Review = require('../../src/testing/StorageFailureReview').default;
  return <Review />;
}
