const fs = require('fs');
let content = fs.readFileSync('electron/services/TelegramMTProtoService.cjs', 'utf-8');

content = content.replace('  ensureConnected() {', 
`  async _handleApiError(e, contextStr) {
    const log = require('electron-log');
    log.error(\`[MTProto] \${contextStr} error:\`, e);
    const errMsg = e.message || String(e);
    if (errMsg.includes('AUTH_KEY_UNREGISTERED')) {
      await this.logout();
      throw new Error('AUTH_KEY_UNREGISTERED');
    }
    throw new Error(errMsg);
  }

  ensureConnected() {`);

content = content.replace(/catch \(e\) \{\s*log\.error\('\[MTProto\] getDialogs error:', e\);\s*const errMsg = e\.message \|\| String\(e\);\s*if \(errMsg\.includes\('AUTH_KEY_UNREGISTERED'\)\) \{\s*await this\.logout\(\);\s*throw new Error\('AUTH_KEY_UNREGISTERED'\);\s*\}\s*throw new Error\(errMsg\);\s*\}/s,
`catch (e) {
      await this._handleApiError(e, 'getDialogs');
    }`);

content = content.replace(/catch \(e\) \{\s*log\.error\('\[MTProto\] sendPost error:', e\);\s*const errMsg = e\.message \|\| String\(e\);\s*if \(errMsg\.includes\('AUTH_KEY_UNREGISTERED'\)\) \{\s*await this\.logout\(\);\s*throw new Error\('AUTH_KEY_UNREGISTERED'\);\s*\}\s*throw new Error\(errMsg\);\s*\}/s,
`catch (e) {
      await this._handleApiError(e, 'sendPost');
    }`);

content = content.replace(/catch \(e\) \{\s*log\.error\('\[MTProto\] searchChannelPosts error:', e\);\s*throw new Error\(e\.message \|\| String\(e\)\);\s*\}/s,
`catch (e) {
      await this._handleApiError(e, 'searchChannelPosts');
    }`);

content = content.replace(/catch \(e\) \{\s*log\.error\('\[MTProto\] getChatAudioFiles error:', e\);\s*throw new Error\(e\.message \|\| String\(e\)\);\s*\}/s,
`catch (e) {
      await this._handleApiError(e, 'getChatAudioFiles');
    }`);

content = content.replace(/catch \(e\) \{\s*log\.error\('\[MTProto\] downloadChatAudioFile error:', e\);\s*throw new Error\(e\.message \|\| String\(e\)\);\s*\}/s,
`catch (e) {
      await this._handleApiError(e, 'downloadChatAudioFile');
    }`);

fs.writeFileSync('electron/services/TelegramMTProtoService.cjs', content);
