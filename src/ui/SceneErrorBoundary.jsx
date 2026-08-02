import { Component } from 'react'

export default class SceneErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="scene-error" role="alert">
          <span>3D RENDER OFFLINE</span>
          <strong>ไม่สามารถเริ่มระบบแสดงผลได้</strong>
          <p>ตรวจสอบว่าเบราว์เซอร์รองรับ WebGL และไฟล์โมเดลยังอยู่ครบ</p>
          <button type="button" onClick={() => window.location.reload()}>
            RETRY VIEWER
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
