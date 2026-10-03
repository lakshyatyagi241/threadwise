import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Messenger setup (WD-FB-015): what a Page's chat greets people with. Four independent pieces, each written straight to Meta and
 * each removable: the Get Started button, the welcome greeting, the persistent menu and the ice breakers.
 */

export const MENU_ITEM_TYPES = ['web_url', 'postback'] as const;

export const menuItemSchema = z.object({
  title: z.string(),
  type: z.enum(MENU_ITEM_TYPES),
  /** For a link. */
  url: z.string(),
  /** For a tap: what comes back to the flow runtime. */
  payload: z.string(),
});
export type MenuItem = z.infer<typeof menuItemSchema>;

export const iceBreakerSchema = z.object({ question: z.string(), payload: z.string() });
export type IceBreaker = z.infer<typeof iceBreakerSchema>;

/** The Messenger profile as the setup screen shows it; an unset piece is empty. */
export const messengerSetupSchema = z.object({
  /** The connected Pages, so the screen can offer a picker. */
  pages: z.array(z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() })),
  /** The Page being edited; null when none is connected. */
  page: z.object({ id: uuidSchema, pageId: z.string(), name: z.string().nullable() }).nullable(),
  getStarted: z.string(),
  greeting: z.string(),
  menu: z.object({ items: z.array(menuItemSchema), composerInputDisabled: z.boolean() }),
  iceBreakers: z.array(iceBreakerSchema),
});
export type MessengerSetup = z.infer<typeof messengerSetupSchema>;

/** A blank payload removes the button (WaDesk saved a blank as a delete). */
export const saveGetStartedSchema = z.object({ payload: z.string().trim().max(1000) });
export type SaveGetStartedInput = z.infer<typeof saveGetStartedSchema>;

/** Meta caps the greeting at 160 characters (longer text is cut); blank removes it. */
export const saveGreetingSchema = z.object({ greeting: z.string().trim().max(2000) });
export type SaveGreetingInput = z.infer<typeof saveGreetingSchema>;

/** At most three items reach Meta; blank rows are skipped. No usable item removes the menu. */
export const saveMenuSchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().max(200),
        type: z.enum(MENU_ITEM_TYPES).default('postback'),
        url: z.string().max(2048).default(''),
        payload: z.string().max(1000).default(''),
      }),
    )
    .max(20),
  composerInputDisabled: z.boolean().default(false),
});
export type SaveMenuInput = z.infer<typeof saveMenuSchema>;

/** At most four reach Meta; blank rows are skipped. None removes them all. */
export const saveIceBreakersSchema = z.object({
  items: z
    .array(z.object({ question: z.string().max(400), payload: z.string().max(1000).default('') }))
    .max(20),
});
export type SaveIceBreakersInput = z.infer<typeof saveIceBreakersSchema>;

/** "Greeting saved.", "Persistent menu removed." and so on: the line the screen shows. */
export const setupResultSchema = z.object({ message: z.string() });
export type SetupResult = z.infer<typeof setupResultSchema>;
