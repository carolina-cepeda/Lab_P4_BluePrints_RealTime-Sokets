import { Client } from '@stomp/stompjs'
// import SockJS from 'sockjs-client' // si quieres fallback

export function createStompClient(baseUrl) {
    const clean = baseUrl.replace(/\/$/, '')
    const wsUrl = clean.replace(/^http/, 'ws') + '/ws-blueprints'

      const client = new Client({
        brokerURL: wsUrl,

        reconnectDelay: 1000,
        heartbeatIncoming: 10000,
        heartbeatOutgoing: 10000,
        onStompError: (f) => console.error('STOMP error', f.headers['message']),
      })
      return client
}

export function subscribeBlueprint(client, author, name, onMsg) {

    const destination = `/topic/blueprints.${author}.${name}`

    const subscription = client.subscribe(destination, (m) => {
        onMsg(JSON.parse(m.body))
    })

    return () => subscription.unsubscribe()
}

