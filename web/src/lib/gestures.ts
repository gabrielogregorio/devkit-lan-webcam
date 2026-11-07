import { fingerAngle, zoomFromPinch } from '@/lib/view';

export interface ScreenPoint {
  x: number;
  y: number;
}

export type GestureChange =
  { type: 'pan'; deltaX: number; deltaY: number } | { type: 'zoom'; zoom: number; rotation: number };

const pointerDistance = (first: ScreenPoint, second: ScreenPoint): number =>
  Math.hypot(first.x - second.x, first.y - second.y);

const pointerAngle = (first: ScreenPoint, second: ScreenPoint): number =>
  fingerAngle(second.x - first.x, second.y - first.y);

// One finger drags the picture; two fingers pinch the zoom and twist the rotation. Screen deltas are scaled to
// canvas pixels; the rotation is the start rotation plus how far the line between the fingers turned.
export class GestureTracker {
  private readonly pointers = new Map<number, ScreenPoint>();
  private lastPanPoint: ScreenPoint | null = null;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;
  private pinchStartAngle = 0;
  private pinchStartRotation = 0;

  down(pointerId: number, point: ScreenPoint, currentZoom: number, currentRotation = 0): void {
    this.pointers.set(pointerId, point);
    if (this.pointers.size === 1) {
      this.lastPanPoint = point;

      return;
    }
    const [first, second] = [...this.pointers.values()];
    if (this.pointers.size === 2 && first && second) {
      this.pinchStartDistance = pointerDistance(first, second);
      this.pinchStartZoom = currentZoom;
      this.pinchStartAngle = pointerAngle(first, second);
      this.pinchStartRotation = currentRotation;
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
        rotation: this.pinchStartRotation + pointerAngle(first, second) - this.pinchStartAngle,
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
