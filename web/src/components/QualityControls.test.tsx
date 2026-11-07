import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QualityControls } from '@/components/QualityControls';
import { DEFAULT_QUALITY } from '@/lib/quality';

describe('QualityControls', () => {
  it('changes resolution, frame rate and image quality', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<QualityControls settings={DEFAULT_QUALITY} averageFrameBytes={null} onChange={onChange} />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Resolution' }), '360p');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Frames per second' }), '15');
    fireEvent.change(screen.getByRole('slider', { name: 'Image quality' }), { target: { value: '0.8' } });

    expect(onChange).toHaveBeenNthCalledWith(1, { ...DEFAULT_QUALITY, resolution: '360p' });
    expect(onChange).toHaveBeenNthCalledWith(2, { ...DEFAULT_QUALITY, fps: 15 });
    expect(onChange).toHaveBeenNthCalledWith(3, { ...DEFAULT_QUALITY, jpegQuality: 0.8 });
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('shows the measured frame size once there is one', () => {
    const { rerender } = render(
      <QualityControls settings={DEFAULT_QUALITY} averageFrameBytes={null} onChange={vi.fn()} />,
    );

    expect(screen.getByText('The size of each frame shows up while streaming.')).toBeInTheDocument();

    rerender(<QualityControls settings={DEFAULT_QUALITY} averageFrameBytes={30 * 1024} onChange={vi.fn()} />);

    expect(screen.getByText('30 KB/frame · 750 KB/s')).toBeInTheDocument();
  });
});
