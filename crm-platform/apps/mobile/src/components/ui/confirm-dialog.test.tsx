import { fireEvent, screen } from '@testing-library/react-native';
import { renderApp } from '@/test/render';
import { ConfirmDialog } from './confirm-dialog';

const props = {
  title: 'Delete contact',
  message: 'This cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
};

describe('ConfirmDialog', () => {
  it('shows nothing while closed', async () => {
    await renderApp(
      <ConfirmDialog {...props} visible={false} onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(screen.queryByText('Delete contact')).toBeNull();
  });

  it('asks, and reports which button was pressed', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    await renderApp(<ConfirmDialog {...props} visible onConfirm={onConfirm} onCancel={onCancel} />);
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
