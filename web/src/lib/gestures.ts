import { zoomFromPinch } from '@/lib/view';

export interface ScreenPoint {
  x: number;
  y: number;
}

export type GestureChange = { type: 'pan'; deltaX: number; deltaY: number } | { type: 'zoom'; zoom: number };

const pointerDistance = (first: ScreenPoint, second: ScreenPoint): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

// One finger drags the picture, two fingers pinch the zoom. Screen deltas are scaled to canvas pixels.
export class GestureTracker {
  private readonly pointers = new Map<number, ScreenPoint>();
  private lastPanPoint: ScreenPoint | null = null;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;

  down(pointerId: number, point: ScreenPoint, currentZoom: number): void {
    this.pointers.set(pointerId, point);
    if (this.pointers.size === 1) {
      this.lastPanPoint = point;

      return;
    }
    const [first, second] = [...this.pointers.values()];
    if (this.pointers.size === 2 && first && second) {
      this.pinchStartDistance = pointerDistance(first, second);
      this.pinchStartZoom = currentZoom;
      this.lastPanPoint = null;
    }
  }

  move(pointerId: number, point: ScreenPoint, canvasScale: number): GestureChange | null {
    if (!this.pointers.has(pointerId)) {
      return null;
    }
    this.pointers.set(pointerId, point);
    if (this.pointers.size === 1 && this.lastPanPoint) {
      const change: GestureChange = {
        type: 'pan',
        deltaX: (point.x - this.lastPanPoint.x) * canvasScale,
        deltaY: (point.y - this.lastPanPoint.y) * canvasScale,
      };
      this.lastPanPoint = point;

      return change;
    }
    const [first, second] = [...this.pointers.values()];
    if (this.pointers.size === 2 && first && second && this.pinchStartDistance > 0) {
      return {
        type: 'zoom',
        zoom: zoomFromPinch(this.pinchStartZoom, this.pinchStartDistance, pointerDistance(first, second)),
      };
    }

    return null;
  }

  up(pointerId: number): void {
    this.pointers.delete(pointerId);
    const [remaining] = [...this.pointers.values()];
    this.lastPanPoint = this.pointers.size === 1 && remaining ? remaining : null;
  }
}
