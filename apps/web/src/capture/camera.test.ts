import { describe, expect, it } from 'vitest';
import { buildCameraConstraints, describeCameraError } from './camera';

describe('camera helpers', () => {
  it('requests a practical default live resolution', () => {
    expect(buildCameraConstraints()).toEqual({
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 60 },
        facingMode: { ideal: 'environment' },
      },
    });
  });

  it('pins a selected camera', () => {
    expect(buildCameraConstraints('camera-2').video).toMatchObject({ deviceId: { exact: 'camera-2' } });
  });

  it('turns permission failures into a useful message', () => {
    expect(describeCameraError(new DOMException('blocked', 'NotAllowedError'))).toContain('permission');
  });
});
