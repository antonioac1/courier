old1 = """  createInbox(agent, purpose, service = 'generic') {
    const inboxId = generateInboxId();
    const aliasValue = `${service}-${crypto.randomBytes(4).toString('hex')}`;"""

new1 = """  createInboxNamed(aliasValue, agent, purpose, service = 'generic') {
    if (!ALIAS_PATTERN.test(aliasValue)) throw new Error('Invalid alias: ' + aliasValue);
    const inboxId = generateInboxId();
    const nowISO = now();
    const inboxRecord = {
      inbox_id: inboxId, agent: agent || 'default', purpose: purpose || '',
      service: service || 'generic', created_at: nowISO, last_access_at: nowISO,
      message_count: 0, abuse_score: 0, retention_mode: 'ephemeral',
      retention_days: 7, expired_at: null, alias: aliasValue, disabled_at: null, metadata: {},
    };
    ensureDir(path.join(this.messagesRoot, inboxId));
    this._saveInbox(inboxRecord);
    return { inbox_id: inboxId, alias: aliasValue, email: `${aliasValue}@inbox.getcourier.dev`,
      created_at: nowISO, agent: inboxRecord.agent, purpose: inboxRecord.purpose,
      retention_mode: inboxRecord.retention_mode, };
  }

  createInbox(agent, purpose, service = 'generic') {
    const inboxId = generateInboxId();
    const aliasValue = `${service}-${crypto.randomBytes(4).toString('hex')}`;"""

old2 = """  createInbox(agent, purpose, service) {
    const result = this.store.createInbox(agent, purpose, service);
    return {"""

new2 = """  createInboxNamed(aliasValue, agent, purpose, service) {
    const result = this.store.createInboxNamed(aliasValue, agent, purpose, service);
    return { inbox_id: result.inbox_id, alias: result.alias, email: result.email,
      agent: result.agent, purpose: result.purpose, created_at: result.created_at,
      retention_mode: result.retention_mode, };
  }

  createInbox(agent, purpose, service) {
    const result = this.store.createInbox(agent, purpose, service);
    return {"""
