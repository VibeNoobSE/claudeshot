registerGame("marble-race", "🔮 Marble Race", "A/D = P1 tilt, ←/→ = P2 tilt", "Race your marble to the bottom!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.walls=this.physics.add.staticGroup();
    // Zigzag ramps
    for(let i=0;i<8;i++){
      const x=i%2===0?W/2-100:W/2+100,y=50+i*55;
      this.walls.add(this.add.rectangle(x,y,350,8,0x444466));
    }
    this.walls.add(this.add.rectangle(W/2,H-10,W,20,0x444466));
    this.m1=this.add.circle(150,20,10,0xf7c948);this.m2=this.add.circle(W-150,20,10,0xe94560);
    [this.m1,this.m2].forEach(m=>{this.physics.add.existing(m);m.body.setBounce(0.5).setGravityY(200).setCollideWorldBounds(true).setDrag(20);});
    this.physics.add.collider(this.m1,this.walls);this.physics.add.collider(this.m2,this.walls);
    this.physics.add.collider(this.m1,this.m2);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",left:"LEFT",right:"RIGHT"});
    this.add.text(W/2,H-30,"First to the bottom wins!",{fontSize:"14px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.over=false;
  }
  update(){if(this.over)return;const k=this.k;
    if(k.a.isDown)this.m1.body.setAccelerationX(-300);else if(k.d.isDown)this.m1.body.setAccelerationX(300);else this.m1.body.setAccelerationX(0);
    if(k.left.isDown)this.m2.body.setAccelerationX(-300);else if(k.right.isDown)this.m2.body.setAccelerationX(300);else this.m2.body.setAccelerationX(0);
    if(this.m1.y>H-30&&!this.over){this.over=true;this.add.text(W/2,H/2,"P1 WINS!",{fontSize:"40px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
    if(this.m2.y>H-30&&!this.over){this.over=true;this.add.text(W/2,H/2,"P2 WINS!",{fontSize:"40px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
