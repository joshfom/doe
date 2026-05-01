import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MediaLibraryPage from './page';
import { useMedia, useUploadMedia, useDeleteMedia, useUpdateMediaAlt } from '@/lib/cms/hooks';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/cms/hooks', () => ({
  useMedia: vi.fn(),
  useUploadMedia: vi.fn(),
  useDeleteMedia: vi.fn(),
  useUpdateMediaAlt: vi.fn(),
}));

Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn(),
  },
});

// ── Test Data ────────────────────────────────────────────────────────────────

const mockItems = [
  {
    id: '1',
    filename: 'photo.jpg',
    altText: 'A nice photo',
    mimeType: 'image/jpeg',
    fileSize: 1024,
    width: 800,
    height: 600,
    storageUrl: 'https://cdn.example.com/photo.jpg',
    storageBackend: 'r2' as const,
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: '2',
    filename: 'banner.png',
    altText: null,
    mimeType: 'image/png',
    fileSize: 2048,
    width: 1200,
    height: 400,
    storageUrl: 'https://cdn.example.com/banner.png',
    storageBackend: 'r2' as const,
    createdAt: '2024-01-02T00:00:00Z',
  },
];

const mockMutate = vi.fn();

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MediaLibraryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (useMedia as ReturnType<typeof vi.fn>).mockReturnValue({ data: mockItems, isLoading: false });
    (useUploadMedia as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false });
    (useDeleteMedia as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: mockMutate, isPending: false });
    (useUpdateMediaAlt as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Grid container has correct responsive Tailwind classes
  it('renders the grid container with correct responsive column classes', () => {
    const { container } = render(<MediaLibraryPage />);
    const grid = container.querySelector('.grid.grid-cols-2.sm\\:grid-cols-3.md\\:grid-cols-4.lg\\:grid-cols-6.gap-2');
    expect(grid).not.toBeNull();
  });

  // 2. Thumbnails use aspect-square and object-cover
  it('renders thumbnails with aspect-square container and object-cover on images', () => {
    const { container } = render(<MediaLibraryPage />);
    const aspectSquareContainers = container.querySelectorAll('.aspect-square');
    expect(aspectSquareContainers.length).toBeGreaterThanOrEqual(2);

    const images = container.querySelectorAll('img');
    images.forEach((img) => {
      expect(img.className).toContain('object-cover');
    });
  });

  // 3. Alt text fallback: when altText is null, img alt uses filename
  it('uses filename as alt text when altText is null', () => {
    render(<MediaLibraryPage />);
    // Item 1 has altText
    const photoImg = screen.getByAltText('A nice photo');
    expect(photoImg).toBeDefined();

    // Item 2 has altText: null, should fall back to filename
    const bannerImg = screen.getByAltText('banner.png');
    expect(bannerImg).toBeDefined();
  });

  // 4. handleCopyLink calls navigator.clipboard.writeText with correct storageUrl
  it('calls navigator.clipboard.writeText with the correct storageUrl on copy click', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MediaLibraryPage />);

    const copyButton = screen.getByLabelText('Copy public link for photo.jpg');
    await act(async () => {
      fireEvent.click(copyButton);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://cdn.example.com/photo.jpg');
  });

  // 5. Copy success feedback: checkmark icon appears, reverts after 2 seconds
  it('shows checkmark icon on successful copy and reverts after 2 seconds', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const { container } = render(<MediaLibraryPage />);

    const copyButton = screen.getByLabelText('Copy public link for photo.jpg');

    await act(async () => {
      fireEvent.click(copyButton);
    });

    // After success, the Check icon should be rendered (ora-gold class)
    const checkIcon = copyButton.querySelector('.text-ora-gold');
    expect(checkIcon).not.toBeNull();

    // After 2 seconds, it should revert
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    const revertedIcon = copyButton.querySelector('.text-ora-gold');
    expect(revertedIcon).toBeNull();
  });

  // 6. Copy failure feedback: error icon appears when clipboard rejects
  it('shows error icon when clipboard copy fails', async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Permission denied'));
    const { container } = render(<MediaLibraryPage />);

    const copyButton = screen.getByLabelText('Copy public link for photo.jpg');

    await act(async () => {
      fireEvent.click(copyButton);
    });

    // After failure, the X icon should be rendered (ora-error class)
    const errorIcon = copyButton.querySelector('.text-ora-error');
    expect(errorIcon).not.toBeNull();
  });

  // 7. Overlay has opacity-0 default and group-hover:opacity-100 class
  it('renders overlay with opacity-0 default and group-hover:opacity-100 class', () => {
    const { container } = render(<MediaLibraryPage />);
    const overlay = container.querySelector('.opacity-0.group-hover\\:opacity-100');
    expect(overlay).not.toBeNull();
  });

  // 8. Overlay buttons have appropriate aria-label attributes
  it('renders overlay buttons with appropriate aria-label attributes', () => {
    render(<MediaLibraryPage />);

    expect(screen.getByLabelText('Copy public link for photo.jpg')).toBeDefined();
    expect(screen.getByLabelText('Edit alt text for photo.jpg')).toBeDefined();
    expect(screen.getByLabelText('Delete photo.jpg')).toBeDefined();

    expect(screen.getByLabelText('Copy public link for banner.png')).toBeDefined();
    expect(screen.getByLabelText('Edit alt text for banner.png')).toBeDefined();
    expect(screen.getByLabelText('Delete banner.png')).toBeDefined();
  });

  // 9. Skeleton loader renders with aspect-square in the compact grid
  it('renders skeleton loader with aspect-square placeholders in the compact grid', () => {
    (useMedia as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<MediaLibraryPage />);

    // Skeleton grid should have the compact column classes
    const skeletonGrid = container.querySelector('.grid.grid-cols-2.sm\\:grid-cols-3.md\\:grid-cols-4.lg\\:grid-cols-6.gap-2');
    expect(skeletonGrid).not.toBeNull();

    // Skeleton placeholders should use aspect-square
    const skeletons = skeletonGrid!.querySelectorAll('.aspect-square');
    expect(skeletons.length).toBeGreaterThanOrEqual(1);
  });

  // 10. Delete confirmation and alt text editing flows still work
  describe('preserved functionality', () => {
    it('shows delete confirmation when delete button is clicked and executes delete on confirm', () => {
      render(<MediaLibraryPage />);

      const deleteButton = screen.getByLabelText('Delete photo.jpg');
      fireEvent.click(deleteButton);

      // Confirmation UI should appear
      const confirmButton = screen.getByText('Confirm Delete');
      expect(confirmButton).toBeDefined();

      // Cancel button should also appear
      const cancelButton = screen.getByText('Cancel');
      expect(cancelButton).toBeDefined();

      // Click confirm
      fireEvent.click(confirmButton);
      expect(mockMutate).toHaveBeenCalled();
    });

    it('shows alt text editing UI when edit button is clicked and saves on Save', () => {
      render(<MediaLibraryPage />);

      const editButton = screen.getByLabelText('Edit alt text for photo.jpg');
      fireEvent.click(editButton);

      // Editing input should appear with current alt text value
      const input = screen.getByDisplayValue('A nice photo');
      expect(input).toBeDefined();

      // Change the value
      fireEvent.change(input, { target: { value: 'Updated alt text' } });

      // Click Save
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);

      expect(mockMutate).toHaveBeenCalled();
    });
  });
});
