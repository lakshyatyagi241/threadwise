import { headerShowsAvatar } from './header-fit';

describe('headerShowsAvatar', () => {
  it('drops the avatar on a 360 dp phone when the ring, a call button, a resolve button and the dots are all there', () => {
    expect(headerShowsAvatar(360, { timer: true, buttons: 3 })).toBe(false);
  });

  it('drops it at 411 dp with all of them too: the name needs the room', () => {
    expect(headerShowsAvatar(411, { timer: true, buttons: 3 })).toBe(false);
  });

  it('keeps it when there are fewer buttons beside the name', () => {
    expect(headerShowsAvatar(360, { timer: true, buttons: 1 })).toBe(true);
    expect(headerShowsAvatar(411, { timer: true, buttons: 2 })).toBe(true);
    expect(headerShowsAvatar(360, { timer: false, buttons: 2 })).toBe(true);
  });

  it('keeps it on a wide screen such as a tablet', () => {
    expect(headerShowsAvatar(768, { timer: true, buttons: 3 })).toBe(true);
  });
});
