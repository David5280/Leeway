// The owner's controls for the weekly email. All app only: the email carries
// the owner's financial summary, so where it goes and whether it goes is
// theirs alone to decide. An assistant can neither read the address nor
// point the email somewhere else.

import { z } from 'zod'
import { AppError } from '../errors.js'
import { sendTestEmail, weeklyEmailView } from '../domain/weeklyEmail/send.js'
import { updateWeeklyEmail, weeklyEmailPatchSchema } from '../domain/weeklyEmail/store.js'
import { defineAction } from './action.js'

export const getWeeklyEmailAction = defineAction({
  name: 'get_weekly_email',
  title: 'Weekly email',
  description:
    'Whether the weekly summary email is on, where and when it goes, and how the last send went.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: (ctx) => weeklyEmailView(ctx),
})

export const setWeeklyEmailAction = defineAction({
  name: 'set_weekly_email',
  title: 'Change the weekly email',
  description:
    'Turn the weekly email on or off, and choose its day, hour and address. Only the fields given change.',
  input: weeklyEmailPatchSchema,
  scope: 'write',
  surface: 'app',
  run: async (ctx, patch) => {
    if (patch.on && !ctx.mailer) {
      throw new AppError(
        'not_configured',
        'Add RESEND_API_KEY and MAIL_FROM to the server before turning the weekly email on',
      )
    }
    await updateWeeklyEmail(ctx.db, patch, ctx.now())
    return weeklyEmailView(ctx)
  },
})

export const sendTestWeeklyEmailAction = defineAction({
  name: 'send_test_weekly_email',
  title: 'Send a test email',
  description: 'Send the weekly email now, marked as a test, to see how it looks.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: (ctx) => sendTestEmail(ctx),
})
