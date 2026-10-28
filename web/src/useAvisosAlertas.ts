import {useEffect,useRef,useState} from 'react';
import type {SupabaseClient} from '@supabase/supabase-js';
import {cargarPendientes,esAlertaNueva} from './notification-data.ts';
import type {ResumenPendientes} from './notification-data.ts';
// Vive en Panel, que se desmonta al cambiar de cuenta. No persiste identificadores.
export function useAvisosAlertas(client:SupabaseClient,cultivos:string[]|null,revision:number){
  const [resumen,setResumen]=useState<ResumenPendientes|null>(null),[error,setError]=useState(false);
  const [aviso,setAviso]=useState<ResumenPendientes|null>(null);
  const ultimaVista=useRef<ResumenPendientes['ultima']>(null);
  const clave=cultivos===null?null:[...cultivos].sort().join(',');
  useEffect(()=>{
    if(clave===null)return;
    let activo=true,pendiente=false;let abort:AbortController|null=null;
    async function actualizar(){
      if(pendiente)return;pendiente=true;abort=new AbortController();
      try{
        const r=await cargarPendientes(client,clave?clave.split(','):[],abort.signal);
        if(!activo)return;
        setResumen(r);setError(false);
        const nueva=esAlertaNueva(r.ultima,ultimaVista.current);
        if(nueva)ultimaVista.current=r.ultima;
        setAviso(prev=>r.cantidad===0?null:nueva?r:prev?{...r}:null);
      }catch{if(activo)setError(true);}finally{pendiente=false;}
    }
    void actualizar();const timer=window.setInterval(()=>{void actualizar();},15000);
    const visible=()=>{if(document.visibilityState==='visible')void actualizar();};
    const foco=()=>{void actualizar();};window.addEventListener('focus',foco);document.addEventListener('visibilitychange',visible);
    return()=>{activo=false;abort?.abort();window.clearInterval(timer);window.removeEventListener('focus',foco);document.removeEventListener('visibilitychange',visible);};
  },[client,clave,revision]);
  return {resumen,error,aviso,ocultar:()=>setAviso(null)};
}
