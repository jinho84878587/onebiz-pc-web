'use strict';
const {check,text}=require('./security');

// Decimal inputs remain decimals; only settlement amounts are rounded to won.
// Eight decimal places also preserve older imported data beyond the Android
// editor's two-decimal input limit without binary floating-point accumulation.
const SCALE=100000000n,PRODUCT_SCALE=SCALE*SCALE;
function units(value){
 const number=Number(value);
 if(!Number.isFinite(number)||number<=0)return 0n;
 const [mantissa,expText='0']=String(number).toLowerCase().split('e');
 const [whole,fraction='']=mantissa.split('.'),digits=BigInt(whole+fraction),shift=8+Number(expText)-fraction.length;
 if(shift>=0)return digits*10n**BigInt(shift);
 return rounded(digits,10n**BigInt(-shift));
}
function rounded(value,divisor){return value<0n?-((-value+divisor/2n)/divisor):(value+divisor/2n)/divisor;}
function calculate(quote){
 const input=Array.isArray(quote.items)?quote.items:[],raw=input.map(item=>units(item.qty)*units(item.unitPrice));
 const subtotal=raw.reduce((a,b)=>a+b,0n),requestedDiscount=units(quote.discountAmount)*SCALE,discount=requestedDiscount>subtotal?subtotal:requestedDiscount;
 const net=Number(rounded(subtotal-discount,PRODUCT_SCALE));
 check(Number.isSafeInteger(net),400,'견적 합계 금액의 허용 범위를 초과했습니다.');
 const included=Number(quote.pricingVersion)>=2,vatEnabled=quote.vatEnabled!==false;
 const vat=vatEnabled?Number(rounded(BigInt(net),included?11n:10n)):0;
 return {input,raw,subtotal,discount,net,vat,total:net+(included?0:vat),included,vatEnabled};
}
function statementLines(quote){
 const p=calculate(quote),base=p.input.map((item,index)=>({name:text(item.name,160),spec:text(item.spec,160),qty:Number(item.qty)||0,unitPrice:Number(item.unitPrice)||0,lineType:'item',baseAmount:Number(rounded(p.raw[index],PRODUCT_SCALE))}));
 const discountAmount=Number(p.discount)/Number(PRODUCT_SCALE),discountRounded=Number(rounded(p.discount,PRODUCT_SCALE));
 if(p.discount>0n)base.push({name:'할인',spec:'원 단위 반올림',qty:null,unitPrice:null,lineType:'discount',baseAmount:-discountRounded});
 const roundingAdjustment=p.net-base.reduce((sum,line)=>sum+line.baseAmount,0);
 if(roundingAdjustment)base.push({name:'원 단위 반올림 조정',spec:'합계 기준 반올림',qty:null,unitPrice:null,lineType:'rounding',baseAmount:roundingAdjustment});
 let accumulated=0,previousVat=0;
 const lines=base.map(line=>{
  accumulated+=line.baseAmount;
  const cumulativeVat=p.vatEnabled?Number(rounded(BigInt(accumulated),p.included?11n:10n)):0,vat=cumulativeVat-previousVat;
  previousVat=cumulativeVat;
  return {...line,supply:p.included?line.baseAmount-vat:line.baseAmount,vat,amount:line.baseAmount+(p.included?0:vat)};
 });
 return {lines,discountAmount,roundingAdjustment,pricingVersion:p.included?2:1};
}
module.exports={calculate,statementLines};
