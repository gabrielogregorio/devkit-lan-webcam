import { GestureTracker } from '@/lib/gestures';
import { ZOOM_MAX } from '@/lib/view';

const CANVAS_SCALE = 2;

describe('GestureTracker', () => {
  it('one finger pans by the screen delta times the canvas scale', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 10, y: 10 }, 1);

    expect(tracker.move(1, { x: 15, y: 7 }, CANVAS_SCALE)).toEqual({ type: 'pan', deltaX: 10, deltaY: -6 });
    expect(tracker.move(1, { x: 16, y: 7 }, CANVAS_SCALE)).toEqual({ type: 'pan', deltaX: 2, deltaY: 0 });
  });

  it('two fingers zoom by the change in distance from the starting zoom', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 }, 1.5);
    tracker.down(2, { x: 100, y: 0 }, 1.5);

    expect(tracker.move(2, { x: 200, y: 0 }, CANVAS_SCALE)).toEqual({ type: 'zoom', zoom: 3, rotation: 0 });
    expect(tracker.move(2, { x: 10_000, y: 0 }, CANVAS_SCALE)).toEqual({ type: 'zoom', zoom: ZOOM_MAX, rotation: 0 });
  });

  it('two fingers twist the rotation from where it was, clockwise positive', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 }, 1, 90);
    tracker.down(2, { x: 100, y: 0 }, 1, 90);

    expect(tracker.move(2, { x: 0, y: 100 }, CANVAS_SCALE)).toEqual({ type: 'zoom', zoom: 1, rotation: 180 });
    expect(tracker.move(2, { x: 0, y: -100 }, CANVAS_SCALE)).toMatchObject({ rotation: 0 });
  });

  it('lifting one of two fingers goes back to panning from the remaining finger', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 }, 1);
    tracker.down(2, { x: 100, y: 0 }, 1);
    tracker.move(1, { x: 5, y: 5 }, CANVAS_SCALE);

    tracker.up(2);

    expect(tracker.move(1, { x: 6, y: 5 }, CANVAS_SCALE)).toEqual({ type: 'pan', deltaX: 2, deltaY: 0 });
  });

  it('ignores a pointer it never saw and a pointer after it is lifted', () => {
    const tracker = new GestureTracker();

    expect(tracker.move(7, { x: 1, y: 1 }, CANVAS_SCALE)).toBeNull();

    tracker.down(1, { x: 0, y: 0 }, 1);
    tracker.up(1);

    expect(tracker.move(1, { x: 1, y: 1 }, CANVAS_SCALE)).toBeNull();
  });

  it('two fingers on the same spot do not zoom', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 5, y: 5 }, 1);
    tracker.down(2, { x: 5, y: 5 }, 1);

    expect(tracker.move(2, { x: 50, y: 5 }, CANVAS_SCALE)).toBeNull();
  });

  it('a third finger is tracked but changes nothing', () => {
    const tracker = new GestureTracker();
    tracker.down(1, { x: 0, y: 0 }, 1);
    tracker.down(2, { x: 100, y: 0 }, 1);
    tracker.down(3, { x: 50, y: 50 }, 1);

    expect(tracker.move(3, { x: 60, y: 60 }, CANVAS_SCALE)).toBeNull();
  });
});
