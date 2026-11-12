import test from 'node:test';
import assert from 'node:assert/strict';
import { titleFromPublicText } from '../scripts/collect-public-html.mjs';

test('public HTML titles keep the full 2027 heading and reject ambassador pages', () => {
  assert.equal(titleFromPublicText('【2027】绿城中国-校园大使(J23661) 工作职责：负责宣传'), '');
  assert.equal(titleFromPublicText('【2027】浙江公司策划管理岗同道人（浙北）(J23693) 工作职责：负责项目'), '【2027】浙江公司策划管理岗同道人（浙北）(J23693) 工作职责：负责项目');
});
