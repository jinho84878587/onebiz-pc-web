'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const pricing=require('../lib/quote-pricing');
test('decimal quantities, prices and discounts use decimal arithmetic and won HALF_UP rounding',()=>{
 const quote={items:[{qty:1.5,unitPrice:10.33},{qty:0.1,unitPrice:0.05}],discountAmount:0,pricingVersion:2};
 assert.equal(pricing.calculate(quote).net,16); // 15.495 + 0.005 = 15.5 exactly
 const discounted=pricing.calculate({...quote,discountAmount:0.01});
 assert.equal(discounted.net,15);
 assert.equal(pricing.calculate({items:[{qty:1.5,unitPrice:100}],discountAmount:1.5,vatEnabled:false,pricingVersion:2}).total,149);
});
for(const included of [false,true])for(const vatEnabled of [false,true]){
 test(`statement line totals reconcile after discount and rounding (included=${included}, VAT=${vatEnabled})`,()=>{
  const quote={items:Array.from({length:23},(_,i)=>({name:'ITEM-'+i,qty:1.5,unitPrice:999.99})),discountAmount:100.5,pricingVersion:included?2:1,vatEnabled};
  const value=pricing.calculate(quote),detail=pricing.statementLines(quote);
  assert.equal(detail.lines.filter(i=>i.lineType==='item').length,23);
  assert.equal(detail.lines.reduce((n,i)=>n+i.amount,0),value.total);
  assert.equal(detail.lines.reduce((n,i)=>n+i.vat,0),value.vat);
  assert.equal(detail.lines.reduce((n,i)=>n+i.supply,0),value.total-value.vat);
  assert.ok(detail.lines.some(i=>i.lineType==='discount'));
 }
 );
}
test('discount is capped at subtotal and unsafe totals fail explicitly',()=>{
 const q={items:[{qty:1,unitPrice:100}],discountAmount:999,pricingVersion:2};
 assert.equal(pricing.calculate(q).total,0);
 assert.equal(pricing.statementLines(q).discountAmount,100);
 assert.throws(()=>pricing.calculate({items:[{qty:1e20,unitPrice:1e20}]}),/허용 범위/);
});
