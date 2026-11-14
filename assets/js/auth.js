import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  getAuth,
  linkWithPopup,
  onAuthStateChanged,
  signInWithCustomToken,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';

const AUTH_ORIGIN = 'https://auth.feildmaster.com';

const app = initializeApp({
  apiKey: 'AIzaSyCy97vTRXkj33Eif5SYJds_RfpI1tY-Kec',
  appId: '1:995842639655:web:53794ef93eb46974eecb02',
  authDomain: 'auth.feildmaster.com',
  projectId: 'feildbase',
});
const auth = getAuth(app);
const functions = getFunctions(app);

const userMenu = document.querySelector('#userMenu');
const loginMenu = document.querySelector('#loginMenu');
const linkedDialog = document.querySelector('#linkedDialog');
const linkRows = [...linkedDialog.querySelectorAll('.linked-row')];
const linkError = linkedDialog.querySelector('.link-error');
const authError = document.querySelector('#authError');

const providers = {
  google: () => new GoogleAuthProvider(),
  github: () => new GithubAuthProvider(),
};

const ALREADY_ATTACHED = 'That account is already attached to a different account.';
const MESSAGES = {
  'auth/account-exists-with-different-credential': 'That email is already used by another sign-in. Sign in the way you did before, then link this account from the menu.',
  'auth/credential-already-in-use': ALREADY_ATTACHED,
  'functions/already-exists': ALREADY_ATTACHED,
  'auth/provider-already-linked': 'That account type is already linked.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window.',
  'auth/unauthorized-domain': 'This site is not allowed to sign in yet.',
  'functions/permission-denied': 'Discord did not accept that sign-in.',
};
const IGNORED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'link/cancelled'];

function messageFor(error) {
  const code = error && error.code;
  if (IGNORED.includes(code)) return '';
  return MESSAGES[code] || 'Could not sign in.';
}

function showAuthError(error) {
  console.debug('Auth error:', error);
  const message = messageFor(error);
  authError.textContent = message;
  authError.hidden = !message;
}

function signedIn(user) {
  return Boolean(user) && !user.isAnonymous;
}

function discordPopup(query) {
  return window.open(`${AUTH_ORIGIN}/discord?${new URLSearchParams(query)}`, 'auth', 'height=800,width=400');
}

function signInDiscord() {
  if (!discordPopup({ origin: location.origin })) showAuthError({ code: 'auth/popup-blocked' });
}

function linkDiscord(user) {
  return new Promise((resolve, reject) => {
    const nonce = crypto.randomUUID();
    const popup = discordPopup({ origin: location.origin, mode: 'link', nonce });
    if (!popup) {
      reject({ code: 'auth/popup-blocked' });
      return;
    }
    const received = { value: false };

    function onMessage({ origin, data, source }) {
      if (origin !== AUTH_ORIGIN || !data || data.event !== 'Discord link' || data.nonce !== nonce) return;
      received.value = true;
      clearInterval(timer);
      window.removeEventListener('message', onMessage);
      if (source) source.postMessage({ event: 'Discord link received', nonce }, AUTH_ORIGIN);
      const { state, code, redirect } = data;
      httpsCallable(functions, 'auth-discord-token')({ state, code, redirect })
        .then(({ data: result }) => {
          if (result !== 'LINKED') throw new Error('Unexpected response');
          return user.getIdToken(true);
        })
        .then(() => resolve(), reject);
    }

    const timer = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(timer);
      setTimeout(() => {
        if (received.value) return;
        window.removeEventListener('message', onMessage);
        reject({ code: 'link/cancelled' });
      }, 1000);
    }, 500);

    window.addEventListener('message', onMessage);
  });
}

function link(name) {
  const user = auth.currentUser;
  if (!signedIn(user)) return Promise.reject({ code: 'link/signed-out' });
  if (name === 'discord') return linkDiscord(user);
  const create = providers[name];
  if (!create) return Promise.reject({ code: 'link/unknown' });
  return linkWithPopup(user, create());
}

async function linkedState(user) {
  const { claims } = await user.getIdTokenResult();
  const ids = user.providerData.map(({ providerId }) => providerId);
  return {
    google: ids.includes('google.com'),
    github: ids.includes('github.com'),
    discord: claims['discord.com'] === true,
  };
}

function signIn(name) {
  authError.hidden = true;
  if (name === 'discord') {
    signInDiscord();
    return;
  }
  signInWithPopup(auth, providers[name]()).catch(showAuthError);
}

function showLinked(state) {
  linkRows.forEach((row) => {
    const isLinked = Boolean(state[row.dataset.provider]);
    row.querySelector('.status').hidden = !isLinked;
    row.querySelector('.link').hidden = isLinked;
  });
}

function refreshLinked(user) {
  if (!signedIn(user)) {
    linkedDialog.close();
    return Promise.resolve();
  }
  return linkedState(user).then((state) => {
    if (auth.currentUser === user) showLinked(state);
  }).catch(console.error);
}

function updateUser(user) {
  const authed = signedIn(user);
  document.body.classList.toggle('authed', authed);
  document.querySelectorAll('.username').forEach((el) => {
    el.textContent = authed ? user.displayName || 'Signed in' : '';
  });
}

onAuthStateChanged(auth, (user) => {
  updateUser(user);
  refreshLinked(user);
});

loginMenu.querySelectorAll('[data-provider]').forEach((button) => {
  button.addEventListener('click', () => {
    loginMenu.hidePopover();
    signIn(button.dataset.provider);
  });
});

userMenu.querySelector('.logout').addEventListener('click', () => {
  userMenu.hidePopover();
  signOut(auth);
});

userMenu.querySelector('.open-linked').addEventListener('click', () => {
  userMenu.hidePopover();
  linkError.hidden = true;
  linkedDialog.showModal();
  refreshLinked(auth.currentUser);
});

linkedDialog.addEventListener('click', (event) => {
  if (event.target === linkedDialog) linkedDialog.close();
});

linkRows.forEach((row) => {
  const button = row.querySelector('.link');
  button.addEventListener('click', () => {
    const user = auth.currentUser;
    linkError.hidden = true;
    button.disabled = true;
    link(row.dataset.provider)
      .then(() => refreshLinked(user))
      .catch((error) => {
        console.debug('Link error:', error);
        const message = messageFor(error);
        linkError.textContent = message;
        linkError.hidden = !message;
      })
      .finally(() => {
        button.disabled = false;
      });
  });
});

window.addEventListener('message', ({ origin, data, source }) => {
  if (origin !== AUTH_ORIGIN || !data || !data.token) return;
  signInWithCustomToken(auth, data.token)
    .then(() => ({ event: 'Auth result', login: true }))
    .catch((error) => ({ event: 'Auth result', login: false, error: error.stack || String(error) }))
    .then((reply) => source.postMessage(reply, origin));
});

[userMenu, loginMenu].forEach((menu) => {
  const trigger = document.querySelector(`[popovertarget="${menu.id}"]`);
  menu.addEventListener('beforetoggle', ({ newState }) => {
    if (newState !== 'open') return;
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
  });
});

const bar = document.querySelector('#bar');
new IntersectionObserver(([entry]) => {
  bar.classList.toggle('show', !entry.isIntersecting && entry.boundingClientRect.top < 0);
}).observe(document.querySelector('h1'));
