registerGame("sumo", "🤼 Sumo", "WASD = P1, Arrows = P2", "Push opponent off the arena!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.gfx=this.add.graphics();this.gfx.lineStyle(3,0x555555);this.gfx.strokeCircle(W/2,H/2,200);
    this.gfx.fillStyle(0x222244,1);this.gfx.fillCircle(W/2,H/2,200);
    this.p1=this.add.circle(W/2-80,H/2,20,0xf7c948);this.p2=this.add.circle(W/2+80,H/2,20,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setBounce(0.8);p.body.setDrag(200);p.body.setMaxVelocity(300);});
    this.physics.add.collider(this.p1,this.p2);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.add.text(W/2,30,"Push your opponent out of the ring!",{fontSize:"16px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.over=false;
  }
  update(){
    if(this.over)return;const s=400,k=this.k;
    if(k.a.isDown)this.p1.body.setAccelerationX(-s);else if(k.d.isDown)this.p1.body.setAccelerationX(s);else this.p1.body.setAccelerationX(0);
    if(k.w.isDown)this.p1.body.setAccelerationY(-s);else if(k.s.isDown)this.p1.body.setAccelerationY(s);else this.p1.body.setAccelerationY(0);
    if(k.left.isDown)this.p2.body.setAccelerationX(-s);else if(k.right.isDown)this.p2.body.setAccelerationX(s);else this.p2.body.setAccelerationX(0);
    if(k.up.isDown)this.p2.body.setAccelerationY(-s);else if(k.down.isDown)this.p2.body.setAccelerationY(s);else this.p2.body.setAccelerationY(0);
    const cx=W/2,cy=H/2;
    if(Phaser.Math.Distance.Between(this.p1.x,this.p1.y,cx,cy)>200){this.over=true;this.add.text(W/2,H/2,"P2 WINS!",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
    if(Phaser.Math.Distance.Between(this.p2.x,this.p2.y,cx,cy)>200){this.over=true;this.add.text(W/2,H/2,"P1 WINS!",{fontSize:"40px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
