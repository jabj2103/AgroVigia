// Fixture local de interfaz para IA, plantillas, historial y red 3D. No usa sesiones ni servicios reales.
// Tres hexagonos sobre el modelo de zonas: Platano (fisico agv-dht22-01 + 5 virtuales), Yuca y Hortalizas (6 virtuales cada uno).
// Los virtuales usan la convencion sim-<12 hex del cultivo>-NN y diez capacidades SIMULADOR_V3.
import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {createClient} from '@supabase/supabase-js';import type {Session} from '@supabase/supabase-js';
import {Panel} from '../src/App.tsx';import 'bootstrap/dist/css/bootstrap.min.css';import '../src/styles.css';
const owner='11111111-1111-4111-8111-111111111111',real='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',cropReal='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const hex=(prefijo:string,n:number)=>prefijo+'-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const cropYuca='cccccccc-cccc-4ccc-8ccc-cccccccccccc',cropHort='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const cultivos=[{id:cropReal,nombre:'Lote Plátano QA',tipo:'Plátano',area:1,unidad_area:'ha',archivado_en:null,plantilla_codigo:'platano' as string|null},
 {id:cropYuca,nombre:'Simulado · Yuca',tipo:'Yuca (simulado)',area:0.5,unidad_area:'ha',archivado_en:null,plantilla_codigo:'yuca' as string|null},
 {id:cropHort,nombre:'Simulado · Hortalizas de clima cálido',tipo:'Hortalizas de clima cálido (simulado)',area:0.5,unidad_area:'ha',archivado_en:null,plantilla_codigo:'hortalizas' as string|null}];
const cultivoDe=(i:number):string=>i<=5?cropReal:i<=11?cropYuca:i<=17?cropHort:(nodos.find(x=>numeroNodo(x.id)===i)?.cultivo_id??cropHort);
const prefijo=(c:string)=>'sim-'+c.replaceAll('-','').slice(0,12)+'-';
const ordinal=(k:number)=>k<=5?k:k<=11?k-5:k-11;
const ZONAS_QA=['Sector norte','Sector sur','Sector central','Sector de drenaje','Sector norte','Sector sur'];
const CODIGOS_ZONA=['zona-norte','zona-sur','zona-central','zona-drenaje'];
// Cuatro sectores por cultivo; los nodos 05 y 06 vuelven a norte y sur (como provisionar-hexagonos.sql).
const zonaId=(c:string,i:number)=>c.slice(0,24)+String(900+i).padStart(12,'0');
// Geometria de los cuatro sectores por defecto, como fraccion del terreno: norte, sur, central y drenaje.
const PLANO=[[0,0,1,0.3],[0,0.7,1,0.3],[0,0.3,0.7,0.4],[0.7,0.3,0.3,0.4]] as const;
const nuevaZona=(c:string,i:number)=>({id:zonaId(c,i),cultivo_id:c,codigo:CODIGOS_ZONA[i]!,nombre:ZONAS_QA[i]!,plano_x:PLANO[i]![0] as number,plano_y:PLANO[i]![1] as number,plano_ancho:PLANO[i]![2] as number,plano_alto:PLANO[i]![3] as number});
const zonasQA=[cropReal,cropYuca,cropHort].flatMap(c=>CODIGOS_ZONA.map((_,i)=>nuevaZona(c,i)));
const nodos=[{id:real,codigo:'agv-dht22-01',cultivo_id:cropReal,habilitado:true,tipo_nodo:'fisico',zona_id:null as string|null,posicion_x:null as number|null,posicion_y:null as number|null},
 ...Array.from({length:17},(_,k)=>({id:id(201+k),codigo:prefijo(cultivoDe(k+1))+String(ordinal(k+1)).padStart(2,'0'),cultivo_id:cultivoDe(k+1),habilitado:true,tipo_nodo:'virtual',
   zona_id:zonaId(cultivoDe(k+1),(ordinal(k+1)-1)%4) as string|null,posicion_x:(ordinal(k+1)>4?0.75:0.25) as number|null,posicion_y:0.5 as number|null}))];
const igual=(u:URL,k:string)=>u.searchParams.get(k)?.startsWith('eq.')?u.searchParams.get(k)!.slice(3):null;
const enLista=(u:URL,k:string)=>u.searchParams.get(k)?.startsWith('in.(')?u.searchParams.get(k)!.slice(4,-1).replaceAll('"','').split(','):null;
const V3=['temperatura_aire','humedad_aire','iluminacion_relativa','radiacion_solar','humedad_suelo_vwc','temperatura_suelo','ph_suelo','conductividad_suelo_ece','precipitacion_60min','velocidad_viento'];
const numeroNodo=(nodoId:string)=>nodoId===real?0:Number(nodoId.slice(-3))-200;
const plantillas=[['yuca','Yuca',18,35,25,29,40,90,60,80,15,40,20,30],['platano','Plátano',18,35,26,30,60,95,75,85,25,50,30,40],['hortalizas','Hortalizas de clima cálido',15,32,20,28,50,85,60,75,20,45,25,35],
 ['mango','Mango',15,38,24,30,40,85,50,70,12,40,18,28],['papaya','Papaya',18,34,22,30,50,90,60,80,20,40,25,32],['maracuya','Maracuyá',18,33,21,30,50,90,60,80,20,45,25,35]] as const;
declare global{interface Window{qaCalls:{name:string;args:Record<string,unknown>}[];qaRonda:number;qaIA:'vacia'|'generada'|'fallida';qaTransicionMs?:number}}
window.qaCalls=[];window.qaRonda=0;window.qaIA='generada';
const respuestaIA={resumen:'La temperatura del aire superó el máximo de la plantilla de plátano en la última hora.',estado_general:'atencion',
 recomendaciones:[{titulo:'Revisar estrés por calor',accion:'Verifica la humedad del suelo con la prueba del puño y riega temprano si está seco.',prioridad:'alta',variable:'temperatura_aire',evidencia:'36,4 °C frente a un máximo de 35 °C a las 14:05.'},
  {titulo:'Vigilar sigatoka',accion:'Inspecciona hojas bajeras: humedad alta y calor favorecen la enfermedad.',prioridad:'media',variable:'humedad_aire',evidencia:'Promedio de 24 h: 82 % HR.'}],
 riego:'Sin sensor de suelo: la demanda de agua es alta por el calor; confirma el suelo antes de regar.',luz:'Índice relativo alto de día; no equivale a lux.',limitaciones:'Datos simulados. No hay sensor de humedad del suelo.'};
const ahoraIso=(s=0)=>new Date(Date.now()-s*1000).toISOString();
const sinMs=(ms:number)=>new Date(ms).toISOString().replace(/\.\d{3}Z$/,'Z');

// Serie inventada por minuto: ciclo diurno de Cartagena, microclima por cultivo y vertice,
// y una subida gradual en el virtual 02 del platano durante los ultimos 90 min para ver tendencia y cruce del maximo.
const OFFSET:Record<string,[number,number,number]>={[cropReal]:[-0.5,6,35],[cropYuca]:[0.4,-3,25],[cropHort]:[-0.2,-5.5,30]};
function valorSerie(nodo:number,variable:string,ms:number){
 const h=((new Date(ms).getUTCHours()+19)%24)+new Date(ms).getUTCMinutes()/60, termica=Math.cos((h-14)/24*2*Math.PI);
 const [dt,dh,suelo]=OFFSET[cultivoDe(Math.max(1,nodo))]??[0,0,30], v=(nodo%6)*0.15, ola=nodo===2?Math.max(0,Math.min(9,(ms-(Date.now()-90*60_000))/60_000*0.1)):0;
 const ruido=Math.sin(ms/97_000+nodo)*0.3;
 if(variable==='temperatura_aire')return Math.round((27.8+3.3*termica+dt+v+ola+ruido)*10)/10;
 if(variable==='humedad_aire')return Math.round(Math.min(100,Math.max(0,74-14*termica+dh-v*2-ola*1.5+ruido*2))*10)/10;
 if(variable==='humedad_suelo_vwc')return Math.round((suelo-1.5*Math.max(0,termica)-v-ola*1.2+ruido)*10)/10;
 if(variable==='temperatura_suelo')return Math.round((25+1.2*termica+dt)*10)/10;
 if(variable==='ph_suelo')return 6.2; if(variable==='conductividad_suelo_ece')return 1.1; if(variable==='precipitacion_60min')return 0;
 if(variable==='velocidad_viento')return Math.round((2.2+Math.max(0,termica))*10)/10;
 const sol=Math.max(0,Math.sin((h-6)/12*Math.PI));
 if(variable==='radiacion_solar')return Math.round(950*sol);
 if(nodo>0)return Math.round((1+85*sol)*10)/10;
 return Math.round(Math.min(4095,40+3800*sol*(0.85+0.1*Math.sin(ms/600_000))));
}
function historial(u:URL){
 const p=(k:string)=>u.searchParams.getAll(k),eq=(k:string)=>u.searchParams.get(k)?.replace(/^eq\./,'');
 const nodoId=eq('nodo_id')!,variable=eq('variable_codigo')!,origen=eq('origen')!,cultivo=eq('cultivo_id')!,n=numeroNodo(nodoId);
 const nodo=nodos.find(x=>x.id===nodoId);
 if(!nodo||nodo.cultivo_id!==cultivo||origen!==(nodo.tipo_nodo==='virtual'?'simulado':'real'))return [];
 const desde=Date.parse(p('tomada_en').find(x=>x.startsWith('gte.'))!.slice(4)),hasta=Date.parse(p('tomada_en').find(x=>x.startsWith('lte.'))!.slice(4));
 const recibidas=Date.parse(u.searchParams.get('recibida_en')!.slice(4)),limite=Number(u.searchParams.get('limit')??500);
 const cursor=/tomada_en\.gt\.([^,)]+)/.exec(u.searchParams.get('or')??'')?.[1];
 const filas=[];
 for(let ms=Math.ceil(Math.max(desde,cursor?Date.parse(cursor)+1:desde)/60_000)*60_000;ms<=hasta&&filas.length<limite;ms+=60_000){
  if(ms+1000>recibidas)break;
  const minuto=Math.floor(ms/60_000),valor=valorSerie(n,variable,ms),base={id:hex('a'+String(n).padStart(7,'0'),minuto*3+['temperatura_aire','humedad_aire','iluminacion_relativa'].indexOf(variable)),
   cultivo_id:cultivo,nodo_id:nodoId,mensaje_id:hex('b'+String(n).padStart(7,'0'),minuto),variable_codigo:variable,tomada_en:sinMs(ms),recibida_en:sinMs(ms+1000),origen};
  filas.push(variable!=='iluminacion_relativa'?{...base,valor}:n>0?{...base,valor,metadatos:{version_payload:3,detalle:{fuente:'generador_sintetico_v1',metodo:'indice_relativo_sintetico_v1'}}}
   :{...base,valor:Math.round(valor*1000/4095)/10,metadatos:{version_payload:2,ldr:{metodo:'adc12_10k_11db_v1',adc_promedio:valor}}});
 }
 return filas;
}
// Estado de la plataforma en memoria: clima por cultivo, pausas, dispositivo por nodo, parametros y ajustes.
const climas=new Map<string,{evento:string;intensidad:number;iniciado_en:string}>();
const pausados=new Set<string>();
const ajustes=new Map<string,{ajustes:Record<string,number>;iniciado_en:string}>();
type Condicion={id:string;cultivo_id:string;tipo:'clima'|'ajuste';evento?:string;intensidad?:number;ajustes?:Record<string,number>;iniciado_en:string;finalizado_en:string|null};
const registro:Condicion[]=[];let serie=7000;const nuevoId=()=>id(++serie);
const cerrar=(cultivo:string,tipo:'clima'|'ajuste')=>{for(const r of registro)if(r.cultivo_id===cultivo&&r.tipo===tipo&&!r.finalizado_en)r.finalizado_en=new Date().toISOString();};
const solicitudes:{id:string;cultivo_id:string;origen:string;estado:string;detalle:string|null;creada_en:string;cerrada_en:string|null}[]=[];
const sugerenciasNuevas:Record<string,unknown>[]=[];
const dispositivos=new Map<string,{tipo_dispositivo:string;protocolo:string;intervalo_segundos:number;configuracion_manual:boolean}>();
const parametros=new Map<string,Record<string,number>>();
let preferencias:{tiempo_real:boolean;refresco_segundos:number;clima_alcance:string}|null={tiempo_real:false,refresco_segundos:10,clima_alcance:'cultivo'};
const TIPOS=[{codigo:'esp32',nombre:'ESP32',descripcion:'Microcontrolador con Wi-Fi integrado y ADC de 12 bits.',protocolos:['mqtt_wifi'],protocolo_defecto:'mqtt_wifi',intervalo_defecto:60,adc_bits:12,conexion:'Publica directo en el broker MQTT por Wi-Fi.',probado:true},
 {codigo:'arduino_uno',nombre:'Arduino Uno',descripcion:'Microcontrolador sin red propia y ADC de 10 bits.',protocolos:['serie_puente_mqtt','mqtt_ethernet'],protocolo_defecto:'serie_puente_mqtt',intervalo_defecto:60,adc_bits:10,conexion:'Envía por USB serie a un equipo puente que publica en MQTT.',probado:false},
 {codigo:'raspberry_pi',nombre:'Raspberry Pi',descripcion:'Computador Linux de placa única, sin ADC propio.',protocolos:['mqtt_wifi','mqtt_ethernet'],protocolo_defecto:'mqtt_wifi',intervalo_defecto:60,adc_bits:null,conexion:'Publica en MQTT desde un programa propio.',probado:false},
 {codigo:'virtual',nombre:'Nodo virtual',descripcion:'Punto simulado de diez variables.',protocolos:['mqtt_simulado'],protocolo_defecto:'mqtt_simulado',intervalo_defecto:30,adc_bits:null,conexion:'Lo publica el servicio de simulación.',probado:true}];
const dispositivoDe=(nd:{id:string;tipo_nodo:string})=>dispositivos.get(nd.id)??(nd.tipo_nodo==='virtual'?{tipo_dispositivo:'virtual',protocolo:'mqtt_simulado',intervalo_segundos:30,configuracion_manual:false}:{tipo_dispositivo:'esp32',protocolo:'mqtt_wifi',intervalo_segundos:60,configuracion_manual:false});
// Efecto aproximado del evento para la demo (el modelo real vive en simulador/clima-modelo.mjs).
// Valor con el efecto completo de un evento; la transicion gradual se aplica en conClima.
function efectoClima(variable:string,valor:number,k:{evento:string;intensidad:number}){
 const f=[0.5,1,1.5][k.intensidad-1]!,r=(x:number)=>Math.round(x*10)/10;
 const d:Record<string,Record<string,number>>={lluvia:{temperatura_aire:-3,humedad_aire:22,humedad_suelo_vwc:14,temperatura_suelo:-1.5,velocidad_viento:3},
  sol_fuerte:{temperatura_aire:6,humedad_aire:-16,humedad_suelo_vwc:-3,temperatura_suelo:4},tierra_seca:{humedad_suelo_vwc:-12,humedad_aire:-8,temperatura_suelo:2},viento:{humedad_aire:-6,temperatura_aire:-1}};
 if(k.evento==='lluvia'&&variable==='precipitacion_60min')return r(25*f);
 if(k.evento==='viento'&&variable==='velocidad_viento')return r(14*f);
 if(k.evento==='lluvia'&&(variable==='radiacion_solar'||variable==='iluminacion_relativa'))return r(valor*0.3);
 if(k.evento==='sol_fuerte'&&variable==='radiacion_solar')return Math.max(valor,1050);
 if(k.evento==='sol_fuerte'&&variable==='iluminacion_relativa')return Math.max(valor,92);
 const delta=d[k.evento]?.[variable];return delta===undefined?valor:r(Math.min(variable.startsWith('humedad')?99:999,Math.max(0,valor+delta*f)));
}
// El ajuste manual se suma despues del clima, con limites fisicos.
// Nada cambia de golpe: el clima y el ajuste avanzan hacia su valor (60 s en la demo, 120 s en el servicio real)
// y vuelven igual de despacio. Las pruebas ponen window.qaTransicionMs = 0 para no esperar.
const avance=(desde:number)=>{const t=window.qaTransicionMs??60_000;return t<=0?1:Math.min(1,Math.max(0,(Date.now()-desde)/t));};
const salientes=new Map<string,{evento:string;intensidad:number;fin:number}>();
const transiciones=new Map<string,{desde:Record<string,number>;meta:Record<string,number>;inicio:number}>();
function ajusteVigente(cultivo:string){const t=transiciones.get(cultivo);if(!t)return {} as Record<string,number>;const p=avance(t.inicio);
 return Object.fromEntries([...new Set([...Object.keys(t.desde),...Object.keys(t.meta)])].map(k=>[k,(t.desde[k]??0)+((t.meta[k]??0)-(t.desde[k]??0))*p]));}
function conClima(variable:string,valor:number,cultivo:string){
 const k=climas.get(cultivo),s=salientes.get(cultivo);let base=valor;
 if(k)base+=(efectoClima(variable,valor,k)-valor)*avance(Date.parse(k.iniciado_en));
 if(s&&avance(s.fin)<1)base+=(efectoClima(variable,valor,s)-valor)*(1-avance(s.fin));
 base=Math.round(base*10)/10;const a=ajusteVigente(cultivo)[variable];if(!a)return base;
 const tope=variable.startsWith('humedad')?100:variable==='ph_suelo'?14:999,piso=variable==='temperatura_aire'?-40:0;
 return Math.round(Math.min(tope,Math.max(piso,base+a))*10)/10;
}
const hayCondicion=(cultivo:string)=>climas.has(cultivo)||ajustes.has(cultivo)||transiciones.has(cultivo)||salientes.has(cultivo);
// Reglas simuladas del cultivo: su ajuste propio o, si no hay, los limites de su plantilla.
function reglasSimuladas(cultivo:string){
 const c=cultivos.find(x=>x.id===cultivo),p=parametros.get(cultivo),pl=plantillas.find(x=>x[0]===c?.plantilla_codigo);
 const lim:[string,number,number][]=p?[['temperatura_aire',p.temperatura_min!,p.temperatura_max!],['humedad_aire',p.humedad_min!,p.humedad_max!],['humedad_suelo_vwc',p.suelo_vwc_min!,p.suelo_vwc_max!]]
  :pl?[['temperatura_aire',pl[2],pl[3]],['humedad_aire',pl[6],pl[7]],['humedad_suelo_vwc',pl[10],pl[11]]]:[];
 return lim.map(([variable_codigo,minimo,maximo],i)=>({id:id(8000+cultivos.findIndex(x=>x.id===cultivo)*10+i),cultivo_id:cultivo,variable_codigo,origen:'simulado',minimo,maximo,habilitada:true,creada_en:ahoraIso(86_400)}));
}
function alertasSimuladas(cultivo:string){
 const ms=Date.now()-20_000,inicio=[climas.get(cultivo)?.iniciado_en,ajustes.get(cultivo)?.iniciado_en].filter(Boolean).sort()[0]!;
 return nodos.filter(n=>n.cultivo_id===cultivo&&n.tipo_nodo==='virtual'&&numeroNodo(n.id)!==17).flatMap(n=>reglasSimuladas(cultivo).flatMap((r,i)=>{
  const k=numeroNodo(n.id),valor=conClima(r.variable_codigo,valorSerie(k,r.variable_codigo,ms),cultivo),limite=valor<r.minimo?'inferior':valor>r.maximo?'superior':null;
  return limite?[{id:id(9000+k*10+i),regla_id:r.id,cultivo_id:cultivo,nodo_id:n.id,variable_codigo:r.variable_codigo,origen:'simulado',limite,umbral:limite==='inferior'?r.minimo:r.maximo,valor_inicial:valor,valor_ultimo:valor,
   abierta_en:inicio,ultima_tomada_en:sinMs(ms),cerrada_en:null,motivo_cierre:null,revisada_en:null,medicion_inicial_id:id(9500+k*10+i),medicion_ultima_id:id(9700+k*10+i),medicion_cierre_id:null}]:[];}));
}
// Respuesta de demostracion: reglas fijas sobre las condiciones activas. En produccion la escribe Gemini desde n8n.
function sugerenciaDemo(cultivo:string,origen:string){
 const c=cultivos.find(x=>x.id===cultivo)!,k=origen==='simulado'?climas.get(cultivo):undefined,a=origen==='simulado'?ajustes.get(cultivo)?.ajustes??{}:{};
 const rec:{titulo:string;accion:string;prioridad:string;variable:string;evidencia:string}[]=[];let estado='favorable',riego='Mantén el riego habitual y confirma la humedad del suelo antes de regar.';
 const lluvia=k?.evento==='lluvia'||(a.precipitacion_60min??0)>0,seco=k?.evento==='tierra_seca'||(a.humedad_suelo_vwc??0)<0,calor=k?.evento==='sol_fuerte'||(a.temperatura_aire??0)>0,viento=k?.evento==='viento'||(a.velocidad_viento??0)>0;
 if(lluvia){estado='atencion';riego='Suspende el riego mientras dure la lluvia y revisa que el drenaje no se encharque.';rec.push({titulo:'Suspender riego y revisar drenaje',accion:'Detén el riego programado y recorre el sector de drenaje para confirmar que el agua corre.',prioridad:'alta',variable:'precipitacion_60min',evidencia:'Lluvia simulada activa en el cultivo.'});}
 if(seco){estado='atencion';riego='Riega temprano o al final de la tarde y confirma la humedad con la prueba del puño.';rec.push({titulo:'Recuperar humedad del suelo',accion:'Programa un riego corto y repite la lectura en una hora para ver si el suelo responde.',prioridad:'alta',variable:'humedad_suelo_vwc',evidencia:'Humedad del suelo simulada por debajo de lo habitual.'});}
 if(calor)rec.push({titulo:'Vigilar estrés por calor',accion:'Evita labores a mediodía y revisa hojas con bordes secos o enrolladas.',prioridad:'media',variable:'temperatura_aire',evidencia:'Temperatura simulada por encima de la referencia.'});
 if(viento)rec.push({titulo:'Proteger plantas del viento',accion:'Revisa tutores y amarres, y aplaza las aplicaciones foliares.',prioridad:'media',variable:'velocidad_viento',evidencia:'Viento simulado por encima de la referencia.'});
 if((a.ph_suelo??0)!==0)rec.push({titulo:'Confirmar el pH del suelo',accion:(a.ph_suelo??0)<0?'El suelo se acidifica: confirma con una muestra antes de encalar.':'El suelo se alcaliniza: confirma con una muestra antes de corregir.',prioridad:'baja',variable:'ph_suelo',evidencia:'pH simulado desplazado respecto a la referencia.'});
 if(!rec.length)rec.push({titulo:'Mantener el seguimiento',accion:'No hay condiciones fuera de lo esperado. Sigue con las revisiones habituales.',prioridad:'baja',variable:'general',evidencia:'Lecturas recientes dentro de los rangos del cultivo.'});
 if(rec.filter(r=>r.prioridad==='alta').length>1)estado='critico';
 const partes=[k?`clima simulado de ${k.evento.replace('_',' ')}`:'',Object.keys(a).length?'ajuste manual activo':''].filter(Boolean);
 return {id:nuevoId(),cultivo_id:cultivo,origen,motivo:'solicitud',estado:'generada',plantilla_codigo:c.plantilla_codigo,modelo:'demostracion-local',error_codigo:null,solicitada_en:ahoraIso(4),completada_en:ahoraIso(0),
  respuesta:{resumen:partes.length?`Análisis pedido con ${partes.join(' y ')} en ${c.nombre}. Son condiciones de prueba, no mediciones reales.`:`Análisis pedido para ${c.nombre}: sin condiciones simuladas activas.`,estado_general:estado,recomendaciones:rec.slice(0,5),riego,
   luz:lluvia?'Con lluvia la luz baja; es esperable y no requiere acción.':'La luz es un índice relativo, no equivale a lux.',limitaciones:origen==='simulado'?'Datos simulados. Respuesta de demostración local, sin llamar a la IA.':'Respuesta de demostración local, sin llamar a la IA. El nodo físico no mide el suelo.'},
  contexto:{hora_local:new Date().toLocaleString('sv-SE',{timeZone:'America/Bogota'}).slice(0,16),periodo_del_dia:'dia',plantilla:{nombre:c.tipo},nodos:[],alertas_abiertas:[]}};
}
const indiceReal=(ms:number)=>Math.round(valorSerie(0,'iluminacion_relativa',ms)*1000/4095)/10;
function estadoRed(){
 // Todos envian (lote nuevo cada ronda) salvo el virtual 06 de yuca (sin datos recientes) y el 06 de hortalizas (sin datos todavia).
 return nodos.map(nd=>{const k=numeroNodo(nd.id),viejo=k===11,sin=k===17||!nd.cultivo_id,ms=Date.now()-(viejo?900_000:20_000),c=cultivos.find(x=>x.id===nd.cultivo_id)??{nombre:null,plantilla_codigo:null};
  const virtual=nd.tipo_nodo==='virtual',clima=climas.get(nd.cultivo_id)??null,cv=(v:string)=>virtual?conClima(v,valorSerie(k,v,ms),nd.cultivo_id):valorSerie(k,v,ms);
  return {nodo_id:nd.id,codigo:nd.codigo,simulado:virtual,habilitado:true,cultivo_id:nd.cultivo_id,cultivo_nombre:c.nombre,plantilla_codigo:c.plantilla_codigo,
   ...dispositivoDe(nd),recepcion_pausada:pausados.has(nd.id),clima_evento:clima?.evento??null,clima_intensidad:clima?.intensidad??null,clima_iniciado_en:clima?.iniciado_en??null,
   proyeccion:!virtual&&clima?{mensaje_id:id(5000+window.qaRonda),tomada_en:sinMs(ms),temperatura:conClima('temperatura_aire',valorSerie(0,'temperatura_aire',ms),nd.cultivo_id),
    humedad:conClima('humedad_aire',valorSerie(0,'humedad_aire',ms),nd.cultivo_id),iluminacion:conClima('iluminacion_relativa',indiceReal(ms),nd.cultivo_id)}:null,
   zona_id:nd.zona_id,zona_nombre:virtual?zonasQA.find(z=>z.id===nd.zona_id)?.nombre??null:null,humedad_suelo:virtual&&!sin?cv('humedad_suelo_vwc'):null,
   origen:sin?null:virtual?'simulado':'real',mensaje_id:sin?null:id(1000+k*100+(viejo?0:window.qaRonda)),tomada_en:sin?null:sinMs(ms),recibida_en:sin?null:sinMs(ms+1000),
   temperatura:sin?null:cv('temperatura_aire'),humedad:sin?null:cv('humedad_aire'),iluminacion:sin?null:virtual?cv('iluminacion_relativa'):indiceReal(ms)};});
}
const client=createClient('https://fixture-no-remoto.supabase.co','sb_publishable_ficticia',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
 const u=new URL(String(input)),name=u.pathname.split('/').at(-1)!;let data:unknown=[];let total:number|undefined;
 const response=(d:unknown,status=200,count?:number)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json',...(count!==undefined?{'Content-Range':'*/'+count}:{})}});
 const cultivo=u.searchParams.get('cultivo_id')?.slice(3),origen=u.searchParams.get('origen')?.slice(3);
 if(u.pathname.includes('/rpc/')){
  const args=init?.body?JSON.parse(String(init.body)):{};window.qaCalls.push({name,args});
  if(name==='estado_red_nodos'){window.qaRonda++;data=estadoRed();}
  else if(name==='aplicar_plantilla_cultivo'){const c=cultivos.find(x=>x.id===args.p_cultivo_id)!;c.plantilla_codigo=args.p_plantilla;parametros.delete(c.id);data=c;}
  else if(name==='establecer_clima'){let n=0;for(const c of cultivos){if(!args.p_todos&&c.id!==args.p_cultivo_id)continue;const a=climas.get(c.id);
    if(a&&(args.p_evento==='normal'||a.evento!==args.p_evento||a.intensidad!==args.p_intensidad))salientes.set(c.id,{evento:a.evento,intensidad:a.intensidad,fin:Date.now()});
    if(args.p_evento==='normal'){if(a){climas.delete(c.id);cerrar(c.id,'clima');n++;}}else if(!a||a.evento!==args.p_evento||a.intensidad!==args.p_intensidad){cerrar(c.id,'clima');const t=new Date().toISOString();climas.set(c.id,{evento:args.p_evento,intensidad:args.p_intensidad,iniciado_en:t});registro.push({id:nuevoId(),cultivo_id:c.id,tipo:'clima',evento:args.p_evento,intensidad:args.p_intensidad,iniciado_en:t,finalizado_en:null});n++;}}
   data={codigo:'CLIMA_ESTABLECIDO',evento:args.p_evento,intensidad:args.p_evento==='normal'?null:args.p_intensidad,cultivos_cambiados:n};}
  else if(name==='ajustar_simulacion'){let n=0;const limpio=Object.fromEntries(Object.entries(args.p_ajustes as Record<string,number>).filter(([,v])=>v!==0)),vacio=!Object.keys(limpio).length;
   for(const c of cultivos){if(!args.p_todos&&c.id!==args.p_cultivo_id)continue;const a=ajustes.get(c.id);
    if(vacio?!!a:(!a||JSON.stringify(a.ajustes)!==JSON.stringify(limpio)))transiciones.set(c.id,{desde:ajusteVigente(c.id),meta:vacio?{}:limpio as Record<string,number>,inicio:Date.now()});
    if(vacio){if(a){ajustes.delete(c.id);cerrar(c.id,'ajuste');n++;}}
    else if(!a||JSON.stringify(a.ajustes)!==JSON.stringify(limpio)){cerrar(c.id,'ajuste');const t=new Date().toISOString();ajustes.set(c.id,{ajustes:limpio,iniciado_en:t});registro.push({id:nuevoId(),cultivo_id:c.id,tipo:'ajuste',ajustes:limpio,iniciado_en:t,finalizado_en:null});n++;}}
   data={codigo:'AJUSTE_ESTABLECIDO',ajustes:limpio,cultivos_cambiados:n};}
  else if(name==='solicitar_sugerencia_ia'){const propias=solicitudes.filter(x=>x.cultivo_id===args.p_cultivo_id&&x.origen===args.p_origen),abierta=propias.find(x=>!x.cerrada_en),ult=propias.at(-1);
   if(abierta)data={codigo:'SOLICITUD_EN_CURSO',solicitud_id:abierta.id};
   else if(ult&&Date.now()-Date.parse(ult.creada_en)<20_000)data={codigo:'SOLICITUD_EN_ESPERA',disponible_en:new Date(Date.parse(ult.creada_en)+20_000).toISOString()};
   else{const q={id:nuevoId(),cultivo_id:args.p_cultivo_id as string,origen:args.p_origen as string,estado:'pendiente',detalle:null,creada_en:new Date().toISOString(),cerrada_en:null as string|null};solicitudes.push(q);
    window.setTimeout(()=>{q.estado='en_proceso';},2000);window.setTimeout(()=>{q.estado='atendida';q.cerrada_en=new Date().toISOString();sugerenciasNuevas.unshift(sugerenciaDemo(q.cultivo_id,q.origen));},5500);
    data={codigo:'SOLICITUD_REGISTRADA',solicitud_id:q.id};}}
  else if(name==='crear_nodo_virtual'){const c=cultivos.find(x=>x.id===args.p_cultivo_id)!;
   if(!zonasQA.some(z=>z.cultivo_id===c.id))CODIGOS_ZONA.forEach((_,i)=>zonasQA.push(nuevaZona(c.id,i)));
   const propios=nodos.filter(x=>x.cultivo_id===c.id&&x.tipo_nodo==='virtual'),zona=(args.p_zona_id as string|null)??zonasQA.filter(z=>z.cultivo_id===c.id).sort((p,q)=>propios.filter(x=>x.zona_id===p.id).length-propios.filter(x=>x.zona_id===q.id).length)[0]!.id;
   let k=1;while(nodos.some(x=>x.codigo===prefijo(c.id)+String(k).padStart(2,'0')))k++;
   const nuevo={id:id(201+nodos.length-1),codigo:prefijo(c.id)+String(k).padStart(2,'0'),cultivo_id:c.id,habilitado:true,tipo_nodo:'virtual',zona_id:zona as string|null,posicion_x:0.5 as number|null,posicion_y:0.5 as number|null};nodos.push(nuevo);data=nuevo;}
  else if(name==='registrar_nodo_fisico'){const k=nodos.filter(x=>x.tipo_nodo==='fisico').length;
   const nuevo={id:id(400+k),codigo:'agv-esp'+(0x4c1d+k).toString(16)+'-'+String(20+k).padStart(2,'0'),cultivo_id:null as unknown as string,habilitado:true,tipo_nodo:'fisico',zona_id:null as string|null,posicion_x:null as number|null,posicion_y:null as number|null};
   nodos.push(nuevo);data={codigo:'NODO_REGISTRADO',nodo:nuevo,clave:'clave-de-demostracion-sin-valor-real-0000000'};}
  else if(name==='regenerar_clave_nodo')data={codigo:'CLAVE_REGENERADA',nodo_id:args.p_nodo_id,clave:'clave-nueva-de-demostracion-sin-valor-00001'};
  else if(name==='eliminar_nodo_fisico'){nodos.splice(nodos.findIndex(x=>x.id===args.p_nodo_id),1);data={codigo:'NODO_ELIMINADO',modo:'borrado',nodo_id:args.p_nodo_id};}
  else if(name==='mover_nodo_virtual'){const nd=nodos.find(x=>x.id===args.p_nodo_id)!,destino=args.p_cultivo_id as string;
   if(!zonasQA.some(z=>z.cultivo_id===destino))CODIGOS_ZONA.forEach((_,i)=>zonasQA.push(nuevaZona(destino,i)));
   const otros=nodos.filter(x=>x.cultivo_id===destino&&x.id!==nd.id);nd.cultivo_id=destino;
   nd.posicion_x=0.5;nd.posicion_y=0.5;nd.zona_id=(args.p_zona_id as string|null)??zonasQA.filter(z=>z.cultivo_id===destino).sort((p,q)=>otros.filter(x=>x.zona_id===p.id).length-otros.filter(x=>x.zona_id===q.id).length)[0]!.id;data=nd;}
  else if(name==='eliminar_nodo_virtual'){const i=nodos.findIndex(x=>x.id===args.p_nodo_id);nodos.splice(i,1);data={codigo:'NODO_ELIMINADO',modo:'borrado',nodo_id:args.p_nodo_id};}
  else if(name==='eliminar_cultivo'){const i=cultivos.findIndex(x=>x.id===args.p_cultivo_id),originales=[cropReal,cropYuca,cropHort].includes(args.p_cultivo_id as string);
   if(originales)return response({message:'CULTIVO_CON_HISTORIAL',code:'22023'},400);
   let n=0;for(const nd of nodos)if(nd.cultivo_id===args.p_cultivo_id){nd.cultivo_id=null as unknown as string;nd.zona_id=null;nd.posicion_x=null;nd.posicion_y=null;n++;}
   cultivos.splice(i,1);data={codigo:'CULTIVO_ELIMINADO',cultivo_id:args.p_cultivo_id,nodos_liberados:n};}
  else if(name==='retirar_nodo_virtual'||name==='desvincular_nodo'){const nd=nodos.find(x=>x.id===args.p_nodo_id)!;nd.cultivo_id=null as unknown as string;nd.zona_id=null;nd.posicion_x=null;nd.posicion_y=null;data=nd;}
  else if(name==='vincular_nodo'){const nd=nodos.find(x=>x.id===args.p_nodo_id)!;nd.cultivo_id=args.p_cultivo_id;data=nd;}
  else if(name==='asignar_zona_nodo'||name==='ubicar_nodo'){const nd=nodos.find(x=>x.id===args.p_nodo_id)!;nd.zona_id=args.p_zona_id;nd.posicion_x=args.p_x??0.5;nd.posicion_y=args.p_y??0.5;data=nd;}
  else if(name==='definir_terreno'){const c=cultivos.find(x=>x.id===args.p_cultivo_id)! as typeof cultivos[number]&{ancho_m?:number|null;largo_m?:number|null};c.ancho_m=args.p_ancho_m;c.largo_m=args.p_largo_m;data=c;}
  else if(name==='crear_sector'){let k=1;while(zonasQA.some(z=>z.cultivo_id===args.p_cultivo_id&&z.codigo==='sector-'+String(k).padStart(2,'0')))k++;
   const z={id:zonaId(args.p_cultivo_id as string,50+zonasQA.length),cultivo_id:args.p_cultivo_id as string,codigo:'sector-'+String(k).padStart(2,'0'),nombre:args.p_nombre as string,plano_x:args.p_x as number,plano_y:args.p_y as number,plano_ancho:args.p_ancho as number,plano_alto:args.p_alto as number};zonasQA.push(z);data=z;}
  else if(name==='editar_sector'){const z=zonasQA.find(x=>x.id===args.p_zona_id)!;Object.assign(z,{nombre:args.p_nombre,plano_x:args.p_x,plano_y:args.p_y,plano_ancho:args.p_ancho,plano_alto:args.p_alto});data=z;}
  else if(name==='eliminar_sector'){if(nodos.some(x=>x.zona_id===args.p_zona_id))return response({message:'SECTOR_CON_NODOS',code:'22023'},400);
   zonasQA.splice(zonasQA.findIndex(x=>x.id===args.p_zona_id),1);data={codigo:'SECTOR_ELIMINADO',zona_id:args.p_zona_id};}
  else if(name==='crear_cultivo'){const nuevo={id:hex('eeeeeeee',cultivos.length+1).replace(/^(.{8})-0000/,'$1-eeee'),nombre:args.p_nombre as string,tipo:args.p_tipo as string,area:Number(args.p_area),unidad_area:args.p_unidad_area as string,archivado_en:null,plantilla_codigo:null as string|null};
   cultivos.push(nuevo);for(const n of (args.p_nodos as string[]|undefined)??[]){const nd=nodos.find(x=>x.id===n);if(nd)nd.cultivo_id=nuevo.id;}data=nuevo;}
  else if(name==='pausar_nodo'){if(args.p_pausar)pausados.add(args.p_nodo_id);else pausados.delete(args.p_nodo_id);data={id:args.p_nodo_id,recepcion_pausada:args.p_pausar};}
  else if(name==='configurar_dispositivo'){const t=TIPOS.find(x=>x.codigo===args.p_tipo)!;
   dispositivos.set(args.p_nodo_id,{tipo_dispositivo:t.codigo,protocolo:args.p_protocolo??t.protocolo_defecto,intervalo_segundos:args.p_intervalo??t.intervalo_defecto,configuracion_manual:args.p_protocolo!==null||args.p_intervalo!==null});
   data={id:args.p_nodo_id,tipo_dispositivo:t.codigo};}
  else if(name==='ajustar_parametros_cultivo'){parametros.set(args.p_cultivo_id,args.p_parametros);data={...args.p_parametros,ajustada:true};}
  else if(name==='restablecer_parametros_cultivo'){parametros.delete(args.p_cultivo_id);data={ajustada:false};}
  else if(name==='guardar_preferencias'){preferencias={tiempo_real:args.p_tiempo_real,refresco_segundos:args.p_refresco_segundos,clima_alcance:args.p_clima_alcance};data=preferencias;}
  else return response({message:'RPC inesperada'},400);
 }else if(name==='perfiles')data={nombre:'Cuenta de prueba'};
 else if(name==='cultivos')data=cultivos;
 // Croquis de Inicio (E2): nodos y zonas del cultivo pedido, con propietario y version de asignacion.
 else if(name==='nodos')data=(igual(u,'cultivo_id')?nodos.filter(n=>n.cultivo_id===igual(u,'cultivo_id')):nodos).map(n=>({agricultor_id:owner,asignacion_version:n.id,...n}));
 else if(name==='zonas')data=igual(u,'cultivo_id')?zonasQA.filter(z=>z.cultivo_id===igual(u,'cultivo_id')):zonasQA;
 else if(name==='tipos_dispositivo')data=TIPOS;
 else if(name==='preferencias_usuario')data=preferencias;
 else if(name==='cultivo_parametros'){const p=parametros.get(cultivo??'');data=p?{cultivo_id:cultivo,...p}:null;}
 else if(name==='clima_cultivo'||name==='ajustes_simulacion'){const ids=(u.searchParams.get('cultivo_id')??'').replace(/^in\.\(|\)$/g,'').replaceAll('"','').split(','),activas=u.searchParams.get('finalizado_en')==='is.null';
  data=registro.filter(r=>r.tipo===(name==='clima_cultivo'?'clima':'ajuste')&&ids.includes(r.cultivo_id)&&(!activas||!r.finalizado_en)).sort((p,q)=>q.iniciado_en.localeCompare(p.iniciado_en));}
 else if(name==='solicitudes_ia')data=solicitudes.filter(x=>x.cultivo_id===cultivo&&x.origen===origen).slice(-1);
 else if(name==='nodo_variables')data=nodos.filter(n=>!enLista(u,'nodo_id')||enLista(u,'nodo_id')!.includes(n.id)).flatMap(n=>n.tipo_nodo==='virtual'?V3.map(v=>({nodo_id:n.id,variable_codigo:v,sensor_modelo:'SIMULADOR_V3'}))
  :['temperatura_aire','humedad_aire','iluminacion_relativa'].map(v=>({nodo_id:n.id,variable_codigo:v,sensor_modelo:v==='iluminacion_relativa'?'LDR':'DHT22'})));
 else if(name==='mediciones'){
  const nodo=u.searchParams.get('nodo_id')?.slice(3)!;const t=sinMs(Date.now()-30_000);const select=u.searchParams.get('select');
  if(u.searchParams.get('mensaje_id')?.startsWith('in.')){ // lotes simulados de un cultivo (Inicio)
   const lista=u.searchParams.get('mensaje_id')!.replace(/^in\.\(|\)$/g,'').replaceAll('"','').split(','),ms=Date.now()-20_000;
   data=lista.flatMap(m=>{const k=Math.floor((Number(m.slice(-12))-1000)/100),nd=nodos.find(x=>numeroNodo(x.id)===k&&x.tipo_nodo==='virtual');
    return nd&&nd.cultivo_id===cultivo?V3.map(v=>({variable_codigo:v,valor:conClima(v,valorSerie(k,v,ms),nd.cultivo_id),tomada_en:sinMs(ms),mensaje_id:m,cultivo_id:cultivo,origen:'simulado'})):[];});}
  else if(select==='mensaje_id')data=nodo===real?null:{mensaje_id:id(7)};
  else if(select==='tomada_en,recibida_en')data=[{tomada_en:t,recibida_en:t}];
  else if(select?.startsWith('variable_codigo,valor,tomada_en,nodo_id')){ // lote actual de un nodo para su dialogo
   const nd=nodos.find(x=>x.id===nodo)!,k=numeroNodo(nodo),ms=Date.now()-20_000,mensaje=u.searchParams.get('mensaje_id')!.slice(3);
   data=(nd.tipo_nodo==='virtual'?V3:['temperatura_aire','humedad_aire','iluminacion_relativa']).map(v=>({variable_codigo:v,tomada_en:sinMs(ms),nodo_id:nodo,mensaje_id:mensaje,origen,
    valor:nd.tipo_nodo==='virtual'?conClima(v,valorSerie(k,v,ms),nd.cultivo_id):v==='iluminacion_relativa'?indiceReal(ms):valorSerie(0,v,ms)}));}
  else if(u.searchParams.has('variable_codigo'))data=historial(u);
  else data=['humedad_aire','iluminacion_relativa','temperatura_aire'].map((v,k)=>({id:id(300+k),cultivo_id:cultivo,nodo_id:nodo,mensaje_id:id(7),variable_codigo:v,valor:[71.2,15.3,31.4][k],tomada_en:t,recibida_en:t,origen,metadatos:{version_payload:2,ldr:{metodo:'adc12_10k_11db_v1',adc_promedio:625}}}));
 }
 else if(name==='cultivo_plantillas')data=plantillas.map(([codigo,nombre,tmin,tmax,tomin,tomax,hmin,hmax,homin,homax,smin,smax,somin,somax])=>({codigo,nombre,descripcion:'Descripción de '+nombre,temperatura_min:tmin,temperatura_max:tmax,
  temperatura_optima_min:tomin,temperatura_optima_max:tomax,humedad_min:hmin,humedad_max:hmax,humedad_optima_min:homin,humedad_optima_max:homax,suelo_vwc_min:smin,suelo_vwc_max:smax,suelo_vwc_optima_min:somin,suelo_vwc_optima_max:somax,luz_requerimiento:'pleno_sol',riego_referencia:'Riego de referencia.',notas:'Notas.',fuente:'Rangos orientativos de prueba.'}));
 else if(name==='reglas_alerta')data=origen==='simulado'?reglasSimuladas(cultivo??''):[];
 else if(name==='alertas'){ // episodios abiertos por reglas fijas cuando el clima o el ajuste sacan un valor de su rango
  const abiertas=u.searchParams.get('cerrada_en')!=='not.is.null'&&u.searchParams.get('revisada_en')!=='not.is.null';
  data=origen==='simulado'&&abiertas&&hayCondicion(cultivo??'')?alertasSimuladas(cultivo!):[];total=(data as unknown[]).length;}
 else if(name==='sugerencias_ia'){
  const base={cultivo_id:cultivo,origen,plantilla_codigo:'platano',modelo:'gemini-3.5-flash-lite',contexto:{hora_local:'2026-11-03 14:05',periodo_del_dia:'dia',plantilla:{nombre:'Plátano'},nodos:[{codigo:origen==='real'?'agv-dht22-01':nodos[2]!.codigo,ultima_captura:ahoraIso(60),valores:{temperatura_aire:36.4,humedad_aire:66}}],alertas_abiertas:[{}]}};
  const pedidas=sugerenciasNuevas.filter(x=>x.cultivo_id===cultivo&&x.origen===origen);
  data=window.qaIA==='vacia'?pedidas:window.qaIA==='fallida'?[{...base,id:id(901),motivo:'periodica',estado:'fallida',respuesta:null,error_codigo:'GEMINI_HTTP_429',solicitada_en:ahoraIso(60),completada_en:ahoraIso(55)},{...base,id:id(900),motivo:'alerta',estado:'generada',respuesta:respuestaIA,error_codigo:null,solicitada_en:ahoraIso(5400),completada_en:ahoraIso(5395)}]
   :[...pedidas,{...base,id:id(900),motivo:'alerta',estado:'generada',respuesta:respuestaIA,error_codigo:null,solicitada_en:ahoraIso(120),completada_en:ahoraIso(115)}];
 }
 else throw new Error('Consulta QA inesperada: '+name);
 return response(data,200,total);
}}});
// Placa simulada de la demo: responde el mismo protocolo serie que el firmware (una orden JSON por linea,
// respuesta con el prefijo AGV). Sirve para recorrer el asistente sin hardware. No es una placa real.
const placaDemo:Record<string,unknown>={};
function responderPlaca(o:Record<string,unknown>):Record<string,unknown>{
 const listo=['wifi_ssid','url','codigo','clave'].every(k=>typeof placaDemo[k]==='string'&&placaDemo[k]);
 if(o.cmd==='info')return {ok:true,fw:'agv-http',version:'1.0.0',placa:'esp32',configurado:listo,codigo:placaDemo.codigo??'',wifi_ssid:placaDemo.wifi_ssid??'',url:placaDemo.url??'',tiene_clave:!!placaDemo.clave,intervalo:placaDemo.intervalo??60,
  sensores:['dht22','ldr'],wifi:listo?'conectado':'sin_configurar',ip:listo?'192.168.1.50':'',reloj:listo,envio:listo?'activo':'sin_configurar',ultimo_envio:placaDemo.enviado?{estado:'ok',http:200,hace_s:1}:null};
 if(o.cmd==='config'){if(typeof o.url==='string'&&!o.url.startsWith('https://'))return {ok:false,error:'URL_INVALIDA'};for(const k of ['wifi_ssid','wifi_clave','url','codigo','clave','intervalo'])if(o[k]!==undefined&&o[k]!==null)placaDemo[k]=o[k];return {ok:true,guardado:true,configurado:true};}
 if(o.cmd==='leer')return {ok:true,temperatura:29.4,humedad:67,adc:1234,iluminacion:30.1};
 if(o.cmd==='enviar'){if(!listo)return {ok:false,error:'SIN_CONFIGURAR'};placaDemo.enviado=true;return {ok:true,estado:'ok',http:200,servidor:'insertado',intervalo:placaDemo.intervalo??60,pausado:false};}
 if(o.cmd==='borrar'){for(const k of Object.keys(placaDemo))delete placaDemo[k];return {ok:true,borrado:true};}
 return {ok:false,error:'ORDEN_DESCONOCIDA'};
}
Object.defineProperty(navigator,'serial',{configurable:true,value:{agvDemo:true,requestPort:async()=>{let salida!:ReadableStreamDefaultController<Uint8Array>;const enc=new TextEncoder(),dec=new TextDecoder();
 return {open:async()=>undefined,close:async()=>undefined,readable:new ReadableStream<Uint8Array>({start(x){salida=x;x.enqueue(enc.encode('[LISTO] fw=agv-http version=1.0.0\n'));}}),
  writable:new WritableStream<Uint8Array>({write(trozo){for(const linea of dec.decode(trozo).split('\n').filter(Boolean)){let r:Record<string,unknown>;try{r=responderPlaca(JSON.parse(linea));}catch{r={ok:false,error:'JSON_INVALIDO'};}salida.enqueue(enc.encode('AGV '+JSON.stringify(r)+'\n'));}}})};}}});
createRoot(document.getElementById('root')!).render(<StrictMode><Panel client={client} sesion={{user:{id:owner,email:'qa@example.test'}} as Session}/></StrictMode>);
