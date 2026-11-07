import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no canvas: the pages draw nothing in unit tests (the E2E covers the real drawing).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
});
