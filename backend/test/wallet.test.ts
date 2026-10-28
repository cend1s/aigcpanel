import assert from "node:assert/strict";
import { test } from "node:test";
import { createRedemptions, redeem, RedeemError } from "../src/redeem.js";
import { now } from "../src/tx.js";
import { credit, debit, getBalance, InsufficientQuota, listLedger, MAX_WALLET_QUOTA, WalletError } from "../src/wallet.js";
import { newUser, setup } from "./helpers.js";

test("入账与扣减都写流水，余额一致", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 500, "topup");
    debit(ctx.db, u.id, 120, "use");
    assert.deepEqual(getBalance(ctx.db, u.id), { quota: 380, usedQuota: 120 });
    const { records } = listLedger(ctx.db, u.id);
    assert.deepEqual(records.map((r: any) => [r.delta, r.balanceAfter]), [[-120, 380], [500, 500]]);
});

test("余额不足时扣减失败且不改动任何数据", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    credit(ctx.db, u.id, 100, "topup");
    assert.throws(() => debit(ctx.db, u.id, 101, "use"), InsufficientQuota);
    assert.deepEqual(getBalance(ctx.db, u.id), { quota: 100, usedQuota: 0 });
    assert.equal(listLedger(ctx.db, u.id).total, 1);
});

test("钱包上限与非法数额被拒绝", async () => {
    const ctx = await setup();
    const u = await newUser(ctx);
    credit(ctx.db, u.id, MAX_WALLET_QUOTA, "topup");
    assert.throws(() => credit(ctx.db, u.id, 1, "topup"), WalletError);
    for (const bad of [0, -5, 1.5, NaN]) {
        assert.throws(() => credit(ctx.db, u.id, bad, "x"), WalletError);
    }
    assert.throws(() => credit(ctx.db, 9999, 1, "x"), WalletError);
});

test("兑换码只能使用一次；过期与无效被拒绝", async () => {
    const ctx = await setup();
    const a = await newUser(ctx, "a@x.com");
    const b = await newUser(ctx, "b@x.com");
    const [key] = createRedemptions(ctx.db, 1, 300);
    assert.equal(await redeem(ctx.db, key, a.id), 300);
    await assert.rejects(redeem(ctx.db, key, b.id), RedeemError);
    assert.equal(getBalance(ctx.db, b.id)!.quota, 0);
    await assert.rejects(redeem(ctx.db, "nope", a.id), RedeemError);
    const [old] = createRedemptions(ctx.db, 1, 10, { expiredTime: now() - 10 });
    await assert.rejects(redeem(ctx.db, old, a.id), RedeemError);
    // 同一个码被并发兑换，只有一次成功
    const [k2] = createRedemptions(ctx.db, 1, 50);
    const results = await Promise.allSettled([redeem(ctx.db, k2, a.id), redeem(ctx.db, k2, b.id), redeem(ctx.db, k2, a.id)]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
