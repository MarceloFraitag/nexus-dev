const { chromium } = require('playwright');
(async()=>{
 const browser=await chromium.launch({headless:true}); const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.NEXUS_UI_URL || 'http://127.0.0.1:5173');
 for(const width of [1440,1024,768,390]){
  await page.setViewportSize({width,height:900});
  await page.getByRole('button',{name:'Conversa',exact:true}).click();
  await page.screenshot({path:`/tmp/nexus-${width}.png`});
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,chat:document.querySelector('.chat-panel').getBoundingClientRect().width, height:document.querySelector('.workspace').getBoundingClientRect().height}));
  if(metrics.overflow || metrics.chat<200 || metrics.height<300) throw Error(JSON.stringify({width,metrics}));
  await page.getByRole('button',{name:'Editor',exact:true}).click();
  if(!await page.locator('.editor-panel').isVisible()) throw Error('Editor invisível');
 }
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Dividir',exact:true}).click();
 const handle=page.getByRole('separator',{name:'Largura dos arquivos'});
 await handle.focus(); await page.keyboard.press('ArrowRight');
 if(await handle.getAttribute('aria-valuenow')!=='260') throw Error('Resize por teclado');
 await page.getByRole('button',{name:'Arquivos',exact:true}).click();
 if(await page.locator('.explorer').isVisible()) throw Error('Explorador não recolheu');
 await page.reload();
 if(await page.locator('.explorer').isVisible()) throw Error('Preferência não persistiu');
 if(errors.length)throw Error(errors.join('\n'));
 console.log('UI: 4 resoluções, alternância de painéis, resize por teclado, recolhimento e persistência OK');
 await browser.close();
})();
