import {
  acceptInvite,
  confirmEmail,
  getUser,
  login,
  logout,
  recoverPassword,
  requestPasswordRecovery,
  verifyRequestOrigin
} from '@netlify/identity';

import { createAccessHandler } from './_shared/access-data.mjs';

export default createAccessHandler({
  auth: {
    acceptInvite,
    confirmEmail,
    getUser,
    login,
    logout,
    recoverPassword,
    requestPasswordRecovery
  },
  verifyOrigin: verifyRequestOrigin,
  onError(error) {
    console.error('[private-access]', {
      name: String(error?.name || 'Error').slice(0, 80),
      status: Number(error?.status) || 0,
      message: String(error?.message || 'identity unavailable').slice(0, 160)
    });
  }
});

export const config = {
  path: '/api/access/*',
  method: ['GET', 'POST'],
  rateLimit: {
    windowLimit: 30,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
