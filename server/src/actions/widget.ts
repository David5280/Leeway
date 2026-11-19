// Actions for the home-screen widget's token. Like agent keys, it is managed
// only from the app, so no assistant can make one or see when it was used.

import { z } from 'zod'
import { createWidgetToken, getWidgetToken, revokeWidgetToken } from '../domain/widgetToken.js'
import { defineAction } from './action.js'

export const getWidgetTokenAction = defineAction({
  name: 'get_widget_token',
  title: 'Get the widget token',
  description: 'Whether the home-screen widget has a token, when it was made and last used.',
  input: z.object({}),
  scope: 'read',
  surface: 'app',
  run: (ctx) => getWidgetToken(ctx.db),
})

export const createWidgetTokenAction = defineAction({
  name: 'create_widget_token',
  title: 'Create the widget token',
  description:
    'Create the token the home-screen widget reads its summary with, replacing any earlier one. The token is shown once.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: (ctx) => createWidgetToken(ctx.db),
})

export const revokeWidgetTokenAction = defineAction({
  name: 'revoke_widget_token',
  title: 'Revoke the widget token',
  description: 'Revoke the widget token; every widget using it stops updating immediately.',
  input: z.object({}),
  scope: 'write',
  surface: 'app',
  run: async (ctx) => {
    await revokeWidgetToken(ctx.db)
    return { revoked: true }
  },
})
