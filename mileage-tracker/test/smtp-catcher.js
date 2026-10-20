// Local SMTP catcher for tests: accepts everything on 127.0.0.1, records each message. Never relays anywhere.
const { SMTPServer } = require('smtp-server'), { simpleParser } = require('mailparser'), fs = require('fs'), path = require('path');
function startCatcher(port, dir) {
  fs.mkdirSync(dir, { recursive: true }); const got = [];
  const srv = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], logger: false, onData(stream, session, cb) {
    simpleParser(stream).then(m => { const rec = { to: m.to && m.to.text, cc: m.cc && m.cc.text, from: m.from && m.from.text, subject: m.subject, text: m.text,
      attachments: m.attachments.map(a => ({ filename: a.filename, size: a.size, contentType: a.contentType })) };
      got.push(rec); fs.writeFileSync(path.join(dir, `msg-${got.length}.json`), JSON.stringify(rec, null, 2)); cb(); }, cb); } });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r({ srv, got, close: () => new Promise(c => srv.close(c)) })));
}
module.exports = { startCatcher };
if (require.main === module) startCatcher(Number(process.argv[2] || 2525), process.argv[3] || '/tmp/mt-mail').then(() => console.log('SMTP catcher listening'));
