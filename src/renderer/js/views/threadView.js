import { api } from '../api.js';
import { createConversation } from '../chat/conversation.js';
import { h } from '../ui/dom.js';
import { userName } from '../ui/userName.js';

// Ruta 'thread': { thread: { id, name, isGroup }, messageId? } → una conversación suelta a pantalla completa.
// La usan el chat de un grupo, el chat de un evento y las menciones en chats desde las notificaciones
// (messageId: va a ese mensaje y lo resalta).
export function createThreadView({ navigate } = {}) {
  const titleEl = h('div', { className: 'thread-title' });
  const conversation = createConversation({ navigate });
  const el = h('div', { className: 'view chat thread-view' }, conversation.el);
  let account = null;
  let visible = false;

  api.onChatEvent(({ accountId, threadId }) => {
    if (!visible || accountId !== account?.id) return;
    if (!threadId || threadId === conversation.threadId) conversation.refresh();
  });

  return {
    el,
    toolbar: titleEl,
    async show(newAccount, { thread, messageId } = {}) {
      account = newAccount;
      visible = true;
      titleEl.replaceChildren();
      if (!account || !thread?.id) {
        conversation.close('Chat no encontrado.');
        return;
      }
      titleEl.replaceChildren('💬 ', userName(thread.name, { fallback: 'Chat' }));
      api.startRealtime(account.id).catch((err) => console.warn('[realtime]', err));
      await conversation.open(account, { participantsCount: 2, ...thread });
      if (messageId && conversation.threadId === thread.id) conversation.goTo(messageId);
    },
    hide() {
      visible = false;
      conversation.close();
    },
    reload: () => conversation.refresh(),
  };
}
