import { chromium, expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import type { CloudKnowledge, CloudKnowledgeWrite } from "../src/lib/supabase/database.types";
import type { KnowledgeEntry } from "../src/features/knowledge/types";
const origin = "http://127.0.0.1:3105", workspaceId = "10000000-0000-4000-8000-000000000001";
async function startServer() {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3105"], { windowsHide: true, stdio: ["ignore","pipe","pipe"], env: {...process.env,NEXT_TELEMETRY_DISABLED:"1"} });
  await new Promise<void>((resolve,reject) => {
    let output = ""; const timer = setTimeout(() => {child.kill();reject(new Error("Server timeout"));},30000);
    child.once("error",error=>{clearTimeout(timer);reject(error);}); child.once("exit",()=>{clearTimeout(timer);reject(new Error(output));});
    const read=(chunk:Buffer)=>{output+=chunk.toString();if(output.includes("Ready in")){clearTimeout(timer);resolve();}};
    child.stdout.on("data",read);child.stderr.on("data",read);
  }); return child;
}
async function entries(page:Page):Promise<KnowledgeEntry[]> {
  return page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open("jewelry-workshop-demo");request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result,tx=db.transaction("knowledgeEntries"),read=tx.objectStore("knowledgeEntries").getAll();tx.oncomplete=()=>{db.close();resolve(read.result);};tx.onabort=()=>{db.close();reject(tx.error);};};
  }));
}
test("Baza wiedzy: dwóch użytkowników pracowni, offline, restart, konflikt, archiwum i usunięcie", async ({},testInfo)=>{
  const tables={knowledge_categories:new Map<string,CloudKnowledge>(),knowledge_entries:new Map<string,CloudKnowledge>()};
  const errors:string[]=[],unexpected:string[]=[];let tick=0,server:ChildProcess|undefined,a:BrowserContext|undefined,b:BrowserContext|undefined;
  await mkdir("test-results",{recursive:true});const profileA=await mkdtemp(join(process.cwd(),"test-results","knowledge-sync-a-")),profileB=await mkdtemp(join(process.cwd(),"test-results","knowledge-sync-b-"));
  async function launch(profile:string,userNumber:number) {
    const context=await chromium.launchPersistentContext(profile,{channel:process.env.PLAYWRIGHT_CHANNEL||undefined,headless:true,serviceWorkers:"block",locale:"pl-PL",viewport:{width:1366,height:900}});
    const user={id:`40000000-0000-4000-8000-00000000000${userNumber}`,email:`member${userNumber}@example.invalid`,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-09-01T00:00:00Z"};
    const expires=Math.floor(Date.now()/1000)+3600;
    const token=[Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"),Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:"authenticated"})).toString("base64url"),Buffer.from("isolated-signature").toString("base64url")].join(".");
    async function intercept(route:Route) {
      const request=route.request(),url=new URL(request.url());if(url.origin===origin)return route.continue();
      const reply=(body:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(body),headers:{"access-control-allow-origin":"*"}});
      if(request.method()==="OPTIONS")return route.fulfill({status:204,headers:{"access-control-allow-origin":"*","access-control-allow-headers":"*","access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS"}});
      if(url.pathname==="/auth/v1/token")return reply({access_token:token,refresh_token:"isolated-refresh",token_type:"bearer",expires_in:3600,expires_at:expires,user});
      if(url.pathname==="/auth/v1/user")return reply(user);if(url.pathname==="/auth/v1/logout")return reply({});
      const many=(items:unknown[])=>reply(request.headers().accept?.includes("vnd.pgrst.object")?items[0]??null:items);
      if(url.pathname==="/rest/v1/workspace_members")return many([{workspace_id:workspaceId}]);
      if(url.pathname==="/rest/v1/workspaces")return many([{id:workspaceId,name:"Pracownia testowa"}]);
      if(["/rest/v1/quotes","/rest/v1/quote_photos"].includes(url.pathname))return many([]);
      const name=url.pathname.slice("/rest/v1/".length) as keyof typeof tables;
      const table=tables[name];if(table){
        if(request.method()==="GET"){
          let found=[...table.values()].filter(row=>`eq.${row.workspace_id}`===url.searchParams.get("workspace_id"));
          const id=url.searchParams.get("id");if(id)found=found.filter(row=>`eq.${row.id}`===id);
          found.sort((a,b)=>a.server_updated_at.localeCompare(b.server_updated_at)||a.id.localeCompare(b.id));return many(found);
        }
        const input=request.postDataJSON() as CloudKnowledgeWrite;
        if(input.workspace_id!==workspaceId)return reply({code:"42501"},403);
        const current=table.get(input.id);
        if(request.method()==="POST"&&current)return reply({code:"23505"},409);
        if(request.method()==="PATCH"&&(!current||url.searchParams.get("revision")!==`eq.${current.revision}`||url.searchParams.get("server_updated_at")!==`eq.${current.server_updated_at}`))return reply(null);
        const saved={...input,server_updated_at:new Date(Date.UTC(2026,8,7,0,0,++tick)).toISOString()};table.set(input.id,saved);return reply(saved);
      }
      unexpected.push(url.pathname);return route.abort();
    }
    await context.route("**/*",intercept);context.pages().forEach(page=>page.on("pageerror",e=>errors.push(e.message)));context.on("page",page=>page.on("pageerror",e=>errors.push(e.message)));return context;
  }
  async function login(page:Page,number:number){
    await page.goto(`${origin}/logowanie`);await page.getByLabel("E-mail",{exact:true}).fill(`member${number}@example.invalid`);await page.getByLabel("Hasło",{exact:true}).fill("isolated-password");
    await page.getByRole("button",{name:"Zaloguj się",exact:true}).click();await expect(page.getByText("Pracownia testowa",{exact:true}).first()).toBeVisible();
    const connect = page.getByRole("button",{name:"Połącz i synchronizuj dane",exact:true});
    await connect.click();
    // Wait for the committed workspace binding before a full page navigation.
    await expect(connect).not.toBeVisible();
    await sync(page);
  }
  async function sync(page:Page){
    await page.goto(origin);const button=page.getByRole("button",{name:"Synchronizuj teraz",exact:true});await expect(button).toBeEnabled();await button.click();
    await expect(page.getByRole("status").filter({hasText:/^Zsynchronizowano$/})).toBeVisible({timeout:20000});await page.goto(`${origin}/cenniki-i-ustawienia`);
  }
  const card=(page:Page)=>page.getByRole("article",{name:"Szmaragd wspólny",exact:true});
  async function edit(page:Page,notes:string){await card(page).getByRole("button",{name:"Edytuj",exact:true}).click();await page.getByLabel("Uwagi",{exact:true}).fill(notes);await page.getByRole("button",{name:"Zapisz rekord",exact:true}).click();await expect(card(page)).toBeVisible();}
  try {
    server=await startServer();a=await launch(profileA,1);let pa=a.pages()[0];
    await pa.goto(`${origin}/cenniki-i-ustawienia`);
    await pa.getByRole("button",{name:"Zarządzaj bazą",exact:true}).click();
    await pa.getByLabel("Nazwa grupy",{exact:true}).fill("Szmaragdy");
    await pa.getByRole("button",{name:"Dodaj grupę",exact:true}).click();
    await expect(pa.getByLabel("Nazwa grupy",{exact:true})).toHaveValue("");
    await pa.getByRole("button",{name:"Wróć do katalogu",exact:true}).click();
    await pa.getByRole("button",{name:"Dodaj rekord",exact:true}).click();await pa.getByLabel("Grupa",{exact:true}).selectOption({label:"Szmaragdy"});
    await pa.getByLabel("Rodzaj / nazwa kamienia",{exact:true}).fill("Szmaragd wspólny");await pa.getByLabel("Waga (ct)",{exact:true}).fill("0,5");await pa.getByLabel("Cena netto za karat",{exact:true}).fill("2000");await pa.getByRole("button",{name:"Zapisz rekord",exact:true}).click();
    await expect(card(pa)).toBeVisible();expect(tables.knowledge_entries.size).toBe(0);const original=(await entries(pa))[0];
    await login(pa,1);expect(tables.knowledge_categories.size).toBe(2);expect(tables.knowledge_entries.size).toBe(1);
    b=await launch(profileB,2);const pb=b.pages()[0];await login(pb,2);await expect(card(pb)).toBeVisible();expect((await entries(pb))[0].id).toBe(original.id);
    await pa.getByRole("button",{name:"Zarządzaj bazą",exact:true}).click();
    await pa.getByRole("button",{name:"Zmień nazwę grupy Szmaragdy",exact:true}).click();
    await pa.getByLabel("Nazwa grupy",{exact:true}).fill("Szmaragdy wspólne");
    await pa.getByRole("button",{name:"Zapisz nazwę",exact:true}).click();
    await expect(card(pa)).toContainText("Szmaragdy wspólne");
    await sync(pa);await sync(pb);await expect(card(pb)).toContainText("Szmaragdy wspólne");
    expect((await entries(pb))[0].subcategoryId).toBe(original.subcategoryId);
    await a.setOffline(true);await edit(pa,"Notatka offline");expect((tables.knowledge_entries.get(original.id)!.payload as KnowledgeEntry).notes).toBe("");
    await a.close();a=await launch(profileA,1);pa=a.pages()[0];await pa.goto(`${origin}/cenniki-i-ustawienia`);
    await expect.poll(()=>(tables.knowledge_entries.get(original.id)!.payload as KnowledgeEntry).notes).toBe("Notatka offline");await sync(pb);expect((await entries(pb))[0].notes).toBe("Notatka offline");
    await a.setOffline(true);await edit(pa,"Wersja A");await edit(pb,"Wersja B");await expect.poll(()=>(tables.knowledge_entries.get(original.id)!.payload as KnowledgeEntry).notes).toBe("Wersja B");
    await a.setOffline(false);const conflict=pa.getByRole("region",{name:"Konflikt Bazy wiedzy",exact:true});await expect(conflict).toBeVisible();
    await conflict.locator("summary").first().click();await conflict.locator("summary").last().click();await expect(conflict).toContainText("Wersja A");await expect(conflict).toContainText("Wersja B");await pa.screenshot({path:testInfo.outputPath("konflikt-bazy-wiedzy.png")});
    await conflict.getByRole("button",{name:"Przyjmij wersję z pracowni",exact:true}).click();await expect(conflict).not.toBeVisible();expect((await entries(pa))[0].notes).toBe("Wersja B");
    await pa.getByRole("button",{name:"Zarządzaj bazą",exact:true}).click();
    await card(pa).getByRole("button",{name:"Archiwizuj",exact:true}).click();await expect(card(pa)).not.toBeVisible();await sync(pb);await pb.getByRole("button",{name:"Zarządzaj bazą",exact:true}).click();await pb.getByLabel("Widok rekordów",{exact:true}).selectOption("archived");await expect(card(pb)).toBeVisible();
    await card(pb).getByRole("button",{name:"Przywróć",exact:true}).click();await sync(pa);await expect(card(pa)).toBeVisible();
    await pa.getByRole("button",{name:"Zarządzaj bazą",exact:true}).click();
    await a.setOffline(true);pa.once("dialog",dialog=>dialog.accept());await card(pa).getByRole("button",{name:"Usuń",exact:true}).click();await expect(card(pa)).not.toBeVisible();
    await a.setOffline(false);await expect.poll(()=>tables.knowledge_entries.get(original.id)!.deleted_at).toBeTruthy();await sync(pb);expect(await entries(pb)).toEqual([]);expect(await entries(pa)).toEqual([]);
    expect(unexpected).toEqual([]);expect(errors).toEqual([]);
  } finally {await a?.close();await b?.close();if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,"exit");server.kill();await exited;}}
});
