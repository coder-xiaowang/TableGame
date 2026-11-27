// Keep stable lobby ids even if a game's title or production hostname changes.
const games = [
  ['game', 'cipher', 'sspy', '速速破译'],
  ['game2', 'words', 'whnc', '我话你猜'],
  ['game3', 'yacht', 'kttz', '快艇骰子'],
  ['game5', 'uno', 'uno', 'UNO'],
  ['game6', 'bull', 'ntw', '牛头王'],
  ['game7', 'manila', 'mnl', '马尼拉'],
  ['game8', 'gems', 'ccbs', '璀璨宝石'],
  ['game9', 'thanks', 'nt', 'No Thanks!'],
  ['game10', 'climb', 'cs', "Can't Stop"],
  ['game11', 'decrypto', 'jmz', '截码战'],
  ['game13', 'cabo', 'cabo', 'CABO'],
  ['game14', 'pigs', 'zxz', '脏小猪'],
  ['game15', 'rummy', 'lm', '拉密'],
  ['game16', 'coup', 'zb', '政变'],
  ['game17', 'stocks', 'ghzh', '股海纵横'],
  ['game18', 'criminal', 'criminal', '犯人在跳舞'],
  ['game19', 'bang', 'bang', 'BANG!'],
  ['game20', 'insider', 'jnr', '局内人'],
  ['game21', 'spy', 'jdwj', '间谍危机'],
  ['game22', 'avalon', 'awl', '阿瓦隆'],
  ['game23', 'dream', 'zypy', '只言片语']
].map(([directory, id, host, name]) => ({directory, id, hostname: host + '.zillionx.xyz', name}));

module.exports = games;
