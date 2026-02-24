import { useEffect, useRef, useState } from 'react'
import { createStompClient, subscribeBlueprint } from './lib/stompClient.js'
import { createSocket } from './lib/socketIoClient.js'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8081'
const CRUD_BASE = `${API_BASE}/blueprints`
const IO_BASE  = import.meta.env.VITE_IO_BASE  ?? 'http://localhost:3001'

export default function App() {
    const [tech, setTech]           = useState('none')
    const [author, setAuthor]       = useState('')
    const [name, setName]           = useState('')
    const [blueprints, setBlueprints] = useState([])
    const [points, setPoints]       = useState([])
    const [currentName, setCurrentName] = useState('')
    const [status, setStatus]       = useState('Sin conectar')

    const canvasRef  = useRef(null)
    const stompRef   = useRef(null)
    const unsubRef   = useRef(null)
    const socketRef  = useRef(null)
    const pointsRef  = useRef([])


    useEffect(() => { pointsRef.current = points }, [points])


    function redraw(pts) {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        if (!pts || pts.length === 0) return

        ctx.fillStyle = '#2563eb'
        ctx.strokeStyle = '#93c5fd'
        ctx.lineWidth = 1

        ctx.beginPath()
        ctx.moveTo(pts[0].x, pts[0].y)
        pts.forEach(p => ctx.lineTo(p.x, p.y))
        ctx.stroke()

        pts.forEach(p => {
            ctx.beginPath()
            ctx.arc(p.x, p.y, 5, 0, Math.PI * 2)
            ctx.fill()
        })
    }

    useEffect(() => { redraw(points) }, [points])


    async function loadAuthor() {
        if (!author) return alert('Escribe un autor')
        try {
            const res = await fetch(`${CRUD_BASE}/${author}`)
            const json = await res.json()

            const list = json.data ?? json
            setBlueprints(Array.isArray(list) ? list : [])
        } catch(e) {
            alert('Error cargando autor: ' + e.message)
        }
    }

    async function selectBlueprint(bpName) {
        try {
            const res = await fetch(`${CRUD_BASE}/${author}/${bpName}`)
            const json = await res.json()
            const bp = json.data ?? json
            const pts = bp.points ?? []
            setCurrentName(bpName)
            setName(bpName)
            setPoints(pts)
            connectRT(bpName)
        } catch(e) {
            alert('Error cargando plano: ' + e.message)
        }
    }

    async function createBlueprint() {
        if (!author || !name) return alert('Completa autor y nombre')
        try {
            await fetch(`${CRUD_BASE}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ author, name, points: [] })
            })
            setPoints([])
            setCurrentName(name)
            connectRT(name)
            await loadAuthor()
        } catch(e) {
            alert('Error creando: ' + e.message)
        }
    }

    async function saveBlueprint() {
        if (!author || !currentName) return alert('Selecciona un plano')
        try {
            for (const point of points) {
                await fetch(`${CRUD_BASE}/${author}/${currentName}/points`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ x: point.x, y: point.y })
                })
            }
            alert('Guardado')
            await loadAuthor()
        } catch(e) {
            alert('Error guardando: ' + e.message)
        }
    }

    async function deleteBlueprint() {
        if (!author || !currentName) return alert('Selecciona un plano')
        if (!confirm(`¿Eliminar ${currentName}?`)) return
        try {
            await fetch(`${CRUD_BASE}/${author}/${currentName}`, {
                method: 'DELETE'
            })
            setPoints([])
            setCurrentName('')
            setName('')
            disconnectRT()
            await loadAuthor()
        } catch(e) {
            alert('Error eliminando: ' + e.message)
        }
    }

    //tiempo real
    function disconnectRT() {
        unsubRef.current?.()
        unsubRef.current = null
        stompRef.current?.deactivate?.()
        stompRef.current = null
        socketRef.current?.disconnect?.()
        socketRef.current = null
        setStatus('Sin conectar')
    }

    function connectRT(bpName) {
        disconnectRT()
        if (tech === 'none') return

        const bpAuthor = author
        const room = `blueprints.${bpAuthor}.${bpName}`

        if (tech === 'stomp') {
            const client = createStompClient(API_BASE)
            stompRef.current = client
            client.onConnect = () => {
                setStatus('STOMP conectado')
                unsubRef.current = subscribeBlueprint(client, bpAuthor, bpName, (upd) => {
                    const pts = upd.points ?? (upd.point ? [...pointsRef.current, upd.point] : pointsRef.current)
                    setPoints([...pts])
                })
            }
            client.onDisconnect = () => setStatus('STOMP desconectado')
            client.activate()

        } else if (tech === 'socketio') {
            const s = createSocket(IO_BASE)
            socketRef.current = s
            s.on('connect', () => {
                setStatus('Socket.IO conectado')
                s.emit('join-room', room)
            })
            s.on('disconnect', () => setStatus('Socket.IO desconectado'))
            s.on('blueprint-update', (upd) => {
                if (upd.point) {
                    setPoints(prev => [...prev, upd.point])
                } else if (upd.points) {
                    setPoints([...upd.points])
                }
            })
        }
    }


    useEffect(() => {
        if (currentName) connectRT(currentName)
        return () => disconnectRT()
    }, [tech])


    function handleCanvasClick(e) {
        if (!currentName) return alert('Selecciona o crea un plano primero')
        const rect = canvasRef.current.getBoundingClientRect()
        const point = {
            x: Math.round(e.clientX - rect.left),
            y: Math.round(e.clientY - rect.top)
        }

        setPoints(prev => [...prev, point])

        if (tech === 'stomp' && stompRef.current?.connected) {
            stompRef.current.publish({
                destination: '/app/draw',
                body: JSON.stringify({ author, name: currentName, point })
            })
        } else if (tech === 'socketio' && socketRef.current?.connected) {
            socketRef.current.emit('draw-event', {
                room: `blueprints.${author}.${currentName}`,
                author,
                name: currentName,
                point
            })
        }
    }


    const totalPoints = blueprints.reduce((acc, bp) => acc + (bp.points?.length ?? 0), 0)


    return (
        <div style={{ fontFamily: 'system-ui', display: 'flex', height: '100vh', overflow: 'hidden' }}>

            {/* PANEL */}
            <aside style={{ width: 260, borderRight: '1px solid #e5e7eb', padding: 16,
                display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>

                <h2 style={{ margin: 0 }}>BluePrints</h2>

                {/* Estado RT */}
                <div style={{ fontSize: 12, color: status.includes('conectado') ? 'green' : '#888' }}>
                    ● {status}
                </div>

                {/* Selector tecnología */}
                <div>
                    <label style={{ fontSize: 12, color: '#666' }}>Tecnología RT</label>
                    <select value={tech} onChange={e => setTech(e.target.value)}
                            style={{ width: '100%', padding: 6, marginTop: 4 }}>
                        <option value="none">None</option>
                        <option value="socketio">Socket.IO</option>
                        <option value="stomp">STOMP</option>
                    </select>
                </div>

                {/* Autor */}
                <div>
                    <label style={{ fontSize: 12, color: '#666' }}>Autor</label>
                    <input value={author} onChange={e => setAuthor(e.target.value)}
                           placeholder="ej: juan" style={{ width: '100%', padding: 6, marginTop: 4 }} />
                    <button onClick={loadAuthor}
                            style={{ width: '100%', marginTop: 6, padding: 6, cursor: 'pointer' }}>
                        Cargar planos
                    </button>
                </div>

                {/* Total puntos */}
                <div style={{ background: '#f3f4f6', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontSize: 12, color: '#666' }}>Total puntos del autor</div>
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{totalPoints}</div>
                </div>

                {/* Lista de planos */}
                <div style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>Planos</div>
                {blueprints.length === 0
                    ? <div style={{ fontSize: 12, color: '#aaa' }}>Sin planos</div>
                    : blueprints.map(bp => (
                        <div key={bp.name}
                             onClick={() => selectBlueprint(bp.name)}
                             style={{
                                 padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                                 background: bp.name === currentName ? '#dbeafe' : '#f9fafb',
                                 border: bp.name === currentName ? '1px solid #3b82f6' : '1px solid #e5e7eb',
                                 display: 'flex', justifyContent: 'space-between'
                             }}>
                            <span>{bp.name}</span>
                            <span style={{ color: '#888', fontSize: 11 }}>{bp.points?.length ?? 0} pts</span>
                        </div>
                    ))
                }

                {/* Acciones */}
                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                    <label style={{ fontSize: 12, color: '#666' }}>Nombre del plano</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                           placeholder="ej: plano-sala"
                           style={{ width: '100%', padding: 6, marginTop: 4, marginBottom: 8 }} />
                    <button onClick={createBlueprint}
                            style={{ width: '100%', padding: 6, marginBottom: 6, cursor: 'pointer' }}>
                        + Crear
                    </button>
                    <button onClick={saveBlueprint}
                            style={{ width: '100%', padding: 6, marginBottom: 6, cursor: 'pointer',
                                background: '#fef9c3', border: '1px solid #ca8a04' }}>
                        ↑ Guardar
                    </button>
                    <button onClick={deleteBlueprint}
                            style={{ width: '100%', padding: 6, cursor: 'pointer',
                                background: '#fee2e2', border: '1px solid #dc2626', color: '#dc2626' }}>
                        ✕ Eliminar
                    </button>
                </div>
            </aside>

            {/* CANVAS */}
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
                <div style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>
                    {currentName ? `${author} / ${currentName} — ${points.length} puntos` : 'Selecciona o crea un plano'}
                </div>
                <canvas ref={canvasRef} width={780} height={520}
                        onClick={handleCanvasClick}
                        style={{ background: 'white', border: '1px solid #e5e7eb',
                            borderRadius: 8, cursor: currentName ? 'crosshair' : 'not-allowed' }} />
                <p style={{ fontSize: 12, color: '#aaa', marginTop: 8 }}>
                    Abre 2 pestañas con el mismo plano para ver colaboración en tiempo real
                </p>
            </main>
        </div>
    )
}