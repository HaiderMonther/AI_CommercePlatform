import { slugify } from './slug.util';

describe('slugify', () => {
  it('slugifies latin names', () => {
    expect(slugify('Baghdad Fashion Store')).toBe('baghdad-fashion-store');
  });

  it('keeps Arabic letters instead of stripping them to an empty slug', () => {
    expect(slugify('متجر بغداد للأزياء')).toBe('متجر-بغداد-للازياء');
  });

  it('normalizes alef variants so similar names do not collide differently', () => {
    expect(slugify('أحمد')).toBe(slugify('احمد'));
  });

  it('trims separators and caps the length', () => {
    expect(slugify('  --Hello--World--  ')).toBe('hello-world');
    expect(slugify('a'.repeat(120)).length).toBe(60);
  });
});
