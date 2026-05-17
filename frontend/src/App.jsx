import { useState, useEffect, useRef } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts'

const WS_URL = 'ws://localhost:8001/live'

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function formatTime(date) {
  return date.toLocaleTimeString()
}

function App() {
  const [connected, setConnected] = useState(false)
  const [hostname, setHostname] = useState('')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [data, setData] = useState(null)
  const [chartData, setChartData] = useState([])
  const [sortConfig, setSortConfig] = useState({ key: 'process', direction: 'asc' })
  const wsRef = useRef(null)

  useEffect(() => {
    setHostname(window.location.hostname || 'localhost')
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    ws.onmessage = (event) => {
      const newData = JSON.parse(event.data)
      console.log("[WS] Received:", newData)
      setData(newData)

      const inboundMB = (newData.network_io?.total_bytes_recv_per_sec || 0) / (1024 * 1024)
      const outboundMB = (newData.network_io?.total_bytes_sent_per_sec || 0) / (1024 * 1024)

      setChartData(prev => {
        const updated = [...prev, { time: formatTime(new Date()), inbound: inboundMB.toFixed(3), outbound: outboundMB.toFixed(3) }]
        if (updated.length > 60) return updated.slice(-60)
        return updated
      })
    }

    return () => ws.close()
  }, [])

  const sortedConnections = [...(data?.connections || [])].sort((a, b) => {
    const aVal = a[sortConfig.key] || ''
    const bVal = b[sortConfig.key] || ''
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1
    return 0
  })

  const topProcesses = [...(data?.processes || [])]
    .sort((a, b) => b.cpu_percent - a.cpu_percent)
    .slice(0, 10)
    .map(p => ({ name: p.name.substring(0, 15), cpu: p.cpu_percent }))

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 p-4">
      <div className="flex items-center justify-between mb-6 bg-slate-800 p-4 rounded-lg">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold">Network Sensor</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-slate-400">{hostname}</span>
          <span className="font-mono">{formatTime(currentTime)}</span>
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-slate-400">{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-slate-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Live Traffic (MB/s)</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
              <Legend />
              <Line type="monotone" dataKey="inbound" stroke="#3b82f6" name="Inbound" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outbound" stroke="#f97316" name="Outbound" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-800 p-4 rounded-lg">
            <div className="text-slate-400 text-sm">CPU</div>
            <div className="text-3xl font-bold text-blue-400">{data?.cpu_percent?.toFixed(1) || 0}%</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg">
            <div className="text-slate-400 text-sm">RAM</div>
            <div className="text-3xl font-bold text-purple-400">{data?.ram_percent?.toFixed(1) || 0}%</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg">
            <div className="text-slate-400 text-sm">Total Sent</div>
            <div className="text-xl font-mono text-orange-400">{formatBytes(data?.network_io?.total_bytes_sent_per_sec * 3600 || 0)}</div>
          </div>
          <div className="bg-slate-800 p-4 rounded-lg">
            <div className="text-slate-400 text-sm">Total Received</div>
            <div className="text-xl font-mono text-blue-400">{formatBytes(data?.network_io?.total_bytes_recv_per_sec * 3600 || 0)}</div>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-lg mb-4">
        <h2 className="text-lg font-semibold mb-4">Active Connections</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-400 border-b border-slate-700">
                {['process', 'hostname', 'remote_ip', 'remote_port', 'local_port', 'status'].map(key => (
                  <th key={key} className="p-2 text-left cursor-pointer hover:text-slate-200" onClick={() => setSortConfig({ key, direction: sortConfig.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                    {key.charAt(0).toUpperCase() + key.slice(1).replace('_', ' ')} {sortConfig.key === key && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedConnections.map((conn, i) => (
                <tr key={i} className={`border-b border-slate-700/50 ${conn.status === 'ESTABLISHED' ? 'bg-green-900/20' : ''}`}>
                  <td className="p-2">{conn.process}</td>
                  <td className="p-2">{conn.hostname}</td>
                  <td className="p-2 font-mono">{conn.remote_ip}</td>
                  <td className="p-2 font-mono">{conn.remote_port}</td>
                  <td className="p-2 font-mono">{conn.local_port}</td>
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-xs ${conn.status === 'ESTABLISHED' ? 'bg-green-600' : 'bg-slate-600'}`}>
                      {conn.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <div className="bg-slate-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Open Ports</h2>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 border-b border-slate-700">
                  <th className="p-2 text-left">Port</th>
                  <th className="p-2 text-left">Protocol</th>
                  <th className="p-2 text-left">Process</th>
                  <th className="p-2 text-left">PID</th>
                </tr>
              </thead>
              <tbody>
                {(data?.open_ports || []).slice(0, 30).map((port, i) => (
                  <tr key={i} className="border-b border-slate-700/50">
                    <td className="p-2 font-mono">{port.local_address?.split(':').pop() || 'N/A'}</td>
                    <td className="p-2">{port.protocol}</td>
                    <td className="p-2">{port.process}</td>
                    <td className="p-2 font-mono">{port.pid || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-slate-800 p-4 rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Top Processes by CPU</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topProcesses} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis type="number" stroke="#64748b" fontSize={10} />
              <YAxis dataKey="name" type="category" stroke="#64748b" fontSize={10} width={100} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
              <Bar dataKey="cpu" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default App